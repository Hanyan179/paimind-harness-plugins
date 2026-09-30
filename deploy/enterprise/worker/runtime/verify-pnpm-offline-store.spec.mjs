import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmod, link, lstat, mkdir, mkdtemp, opendir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import test from 'node:test'
import {
  composePnpmOfflineStoreConsumptionEvidence,
  composePnpmOfflineStorePolicyEvidence,
  verifyPnpmOfflineStore,
  WORKER_OFFLINE_STORE_CONTRACT,
} from './verify-pnpm-offline-store.mjs'
import {
  WORKER_BUILD_ROOT_CONTRACT,
  WORKER_BUILD_ROOT_CONTRACT_DIGEST,
} from './worker-build-root-contract.mjs'

async function chmodTree(root, directoryMode, fileMode) {
  const metadata = await lstat(root)
  if (metadata.isSymbolicLink()) return
  if (metadata.isDirectory()) {
    await chmod(root, directoryMode)
    const directory = await opendir(root)
    for await (const entry of directory) await chmodTree(join(root, entry.name), directoryMode, fileMode)
  } else if (metadata.isFile()) {
    await chmod(root, fileMode)
  }
}

async function fixture(t, temporaryPrefix = join(tmpdir(), 'paimind-offline-store-')) {
  const temporaryRoot = await mkdtemp(temporaryPrefix)
  const configuredRoot = join(temporaryRoot, 'store')
  const filesRoot = join(configuredRoot, 'v11', 'files', 'aa')
  await mkdir(filesRoot, { recursive: true })
  await Promise.all([
    writeFile(join(configuredRoot, 'v11', 'index.db'), Buffer.from('fixture-sqlite-index', 'utf8')),
    writeFile(join(filesRoot, 'manifest'), `${JSON.stringify({
      name: WORKER_OFFLINE_STORE_CONTRACT.requiredPackage.name,
      version: WORKER_OFFLINE_STORE_CONTRACT.requiredPackage.version,
    })}\n`),
    writeFile(join(filesRoot, 'content'), Buffer.from('locked-package-content', 'utf8')),
  ])
  await chmodTree(configuredRoot, 0o555, 0o444)
  t.after(async () => {
    await chmodTree(configuredRoot, 0o755, 0o644).catch(() => undefined)
    await rm(temporaryRoot, { recursive: true, force: true })
  })
  return { temporaryRoot, configuredRoot, filesRoot }
}

function options(source, overrides = {}) {
  return {
    configuredRoot: source.configuredRoot,
    requireImmutableModes: true,
    requiredOwnerUid: process.getuid?.(),
    ...overrides,
  }
}

function digest(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function normalizationReceipt(overrides = {}) {
  const sourceRoot = WORKER_BUILD_ROOT_CONTRACT.roots.source.path
  const storeRoot = WORKER_BUILD_ROOT_CONTRACT.roots.store.path
  const projectsRoot = join(storeRoot, 'v11', 'projects')
  const projectId = createHash('sha256').update(sourceRoot).digest('hex').slice(0, 32)
  return {
    schemaVersion: 1,
    status: 'PASS',
    packageManager: 'pnpm@11.7.0',
    policy: 'pnpm-v11-project-registry-exact-link-removal-v1',
    evidenceRole: 'pre-seal-generated-metadata-removal',
    rootContractDigest: WORKER_BUILD_ROOT_CONTRACT_DIGEST,
    sourceRootDigest: digest(sourceRoot),
    storeRootDigest: digest(storeRoot),
    registryPathDigest: digest(`v11/projects/${projectId}`),
    linkTargetDigest: digest(relative(projectsRoot, sourceRoot)),
    removedEntries: 1,
    unexpectedEntries: 0,
    residualSymlinks: 0,
    registryDirectoryRemoved: true,
    ...overrides,
  }
}

async function rejectWithoutSeal(source, pattern, testHooks) {
  let seal
  await assert.rejects(async () => {
    seal = await verifyPnpmOfflineStore(options(source), testHooks)
  }, pattern)
  assert.equal(seal, undefined)
}

async function mutateStoreFile(source, mutation) {
  await chmod(source.filesRoot, 0o755)
  try {
    await mutation()
  } finally {
    await chmod(source.filesRoot, 0o555)
  }
}

test('seals one immutable pnpm v11 store and proves the same bytes through a read-only consumer', async t => {
  const source = await fixture(t)
  const seal = await verifyPnpmOfflineStore(options(source))
  assert.equal(seal.status, 'PASS')
  assert.equal(seal.packageManager, 'pnpm@11.7.0')
  assert.equal(WORKER_OFFLINE_STORE_CONTRACT.configuredRoot, WORKER_BUILD_ROOT_CONTRACT.roots.store.path)
  assert.equal(seal.rootContractDigest, WORKER_BUILD_ROOT_CONTRACT_DIGEST)
  assert.equal(seal.versionDirectory, 'v11')
  assert.ok(seal.files >= 3)
  assert.ok(seal.directories >= 4)
  assert.ok(seal.bytes > 0)
  assert.match(seal.configuredRootDigest, /^sha256:[a-f0-9]{64}$/u)
  assert.match(seal.contentDigest, /^sha256:[a-f0-9]{64}$/u)
  assert.deepEqual(seal.requiredPackage, WORKER_OFFLINE_STORE_CONTRACT.requiredPackage)
  assert.equal(seal.requiredPackageManifestMatches, 1)
  assert.equal(seal.immutableModes, true)
  assert.equal(seal.readOnlyMount, false)
  assert.equal(JSON.stringify(seal).includes(source.configuredRoot), false)

  const sealPath = join(source.temporaryRoot, 'seal.json')
  await writeFile(sealPath, `${JSON.stringify(seal)}\n`)
  const consumed = await verifyPnpmOfflineStore(options(source, {
    expectedSealPath: sealPath,
    requireReadOnlyMount: true,
  }))
  assert.equal(consumed.contentDigest, seal.contentDigest)
  assert.equal(consumed.readOnlyMount, true)
  const evidence = composePnpmOfflineStoreConsumptionEvidence({
    normalization: normalizationReceipt(),
    seal,
    installBefore: consumed,
    installAfter: consumed,
    deployBefore: consumed,
    deployAfter: consumed,
  })
  assert.equal(evidence.status, 'PASS')
  assert.equal(evidence.rootContractDigest, WORKER_BUILD_ROOT_CONTRACT_DIGEST)
  assert.equal(evidence.contentDigest, seal.contentDigest)
  assert.deepEqual(evidence.projectRegistryNormalization, normalizationReceipt())
  assert.deepEqual(Object.keys(evidence).sort(), [
    'schemaVersion',
    'status',
    'packageManager',
    'rootContractDigest',
    'configuredRootDigest',
    'versionDirectory',
    'files',
    'directories',
    'bytes',
    'contentDigest',
    'requiredPackage',
    'requiredPackageManifestMatches',
    'immutableModes',
    'projectRegistryNormalization',
    'readOnlyConsumers',
    'unchangedAfterConsumers',
    'consumerNetworkPolicy',
    'hostStoreDependency',
  ].sort())
  assert.equal(evidence.unchangedAfterConsumers, true)
  assert.equal(evidence.hostStoreDependency, false)
  assert.equal(Object.hasOwn(evidence, 'configuredRoot'), false)
  assert.throws(
    () => composePnpmOfflineStoreConsumptionEvidence({
      normalization: normalizationReceipt(),
      seal,
      installBefore: { ...consumed, contentDigest: `sha256:${'0'.repeat(64)}` },
      installAfter: consumed,
      deployBefore: consumed,
      deployAfter: consumed,
    }),
    /changed or lost/u,
  )
  assert.throws(
    () => composePnpmOfflineStoreConsumptionEvidence({
      normalization: normalizationReceipt(),
      seal,
      installBefore: { ...consumed, rootContractDigest: `sha256:${'0'.repeat(64)}` },
      installAfter: consumed,
      deployBefore: consumed,
      deployAfter: consumed,
    }),
    /not a valid locked pnpm offline-store receipt/u,
  )
})

test('hashes Store files with bounded concurrency while preserving a deterministic digest', async t => {
  const source = await fixture(t)
  let active = 0
  let maximumActive = 0
  let firstHook = true
  const secondHook = Promise.withResolvers()
  const first = await verifyPnpmOfflineStore(options(source), {
    async afterInitialFileStat() {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      try {
        if (firstHook) {
          firstHook = false
          const timeout = setTimeout(
            () => secondHook.reject(new Error('bounded Store hashing did not start a second file')),
            1_000,
          )
          try {
            await secondHook.promise
          } finally {
            clearTimeout(timeout)
          }
        } else {
          secondHook.resolve()
        }
      } finally {
        active -= 1
      }
    },
  })
  const second = await verifyPnpmOfflineStore(options(source))
  assert.ok(maximumActive >= 2)
  assert.equal(first.contentDigest, second.contentDigest)
  assert.equal(first.files, second.files)
  assert.equal(first.bytes, second.bytes)
})

test('policy-only evidence cannot be substituted for application install/deploy evidence', async t => {
  const source = await fixture(t)
  const seal = await verifyPnpmOfflineStore(options(source))
  const consumer = { ...seal, readOnlyMount: true }
  const receipts = { normalization: normalizationReceipt(), seal, policyBefore: consumer, policyAfter: consumer }
  const result = composePnpmOfflineStorePolicyEvidence(receipts)
  assert.equal(result.evidenceRole, 'policy-probes-only')
  assert.equal(result.finalWorkerImageAccepted, false)
  assert.equal(result.contentDigest, seal.contentDigest)
  assert.throws(() => composePnpmOfflineStoreConsumptionEvidence(receipts), /receipt set is invalid/u)
  assert.throws(() => composePnpmOfflineStorePolicyEvidence({ ...receipts, deployAfter: consumer }), /receipt set is invalid/u)
  assert.throws(() => composePnpmOfflineStorePolicyEvidence({ ...receipts, policyAfter: seal }), /lost its read-only contract/u)
  assert.throws(() => composePnpmOfflineStorePolicyEvidence({ ...receipts,
    policyAfter: { ...consumer, contentDigest: `sha256:${'0'.repeat(64)}` } }), /consumer changed/u)
  assert.throws(() => composePnpmOfflineStorePolicyEvidence({ ...receipts,
    normalization: normalizationReceipt({ residualSymlinks: 1 }) }), /normalization contract/u)
})

test('requires one exact Project Registry normalization receipt before composing Store seals', async t => {
  const source = await fixture(t)
  const seal = await verifyPnpmOfflineStore(options(source))
  const consumed = { ...seal, readOnlyMount: true }
  const receiptSet = {
    normalization: normalizationReceipt(),
    seal,
    installBefore: consumed,
    installAfter: consumed,
    deployBefore: consumed,
    deployAfter: consumed,
  }

  const { normalization: _missing, ...missing } = receiptSet
  assert.throws(
    () => composePnpmOfflineStoreConsumptionEvidence(missing),
    /receipt set is invalid/u,
  )
  assert.throws(
    () => composePnpmOfflineStoreConsumptionEvidence({ ...receiptSet, extra: true }),
    /receipt set is invalid/u,
  )

  for (const [name, normalization] of [
    ['store cross-digest', normalizationReceipt({ storeRootDigest: `sha256:${'0'.repeat(64)}` })],
    ['root cross-digest', normalizationReceipt({ rootContractDigest: `sha256:${'0'.repeat(64)}` })],
    ['policy', normalizationReceipt({ policy: 'allow-project-registry-links' })],
    ['removed count', normalizationReceipt({ removedEntries: 0 })],
    ['unexpected count', normalizationReceipt({ unexpectedEntries: 1 })],
    ['residual count', normalizationReceipt({ residualSymlinks: 1 })],
  ]) {
    await t.test(name, () => {
      assert.throws(
        () => composePnpmOfflineStoreConsumptionEvidence({ ...receiptSet, normalization }),
        /does not match the locked pnpm Project Registry normalization contract/u,
      )
    })
  }
})

test('fails closed on missing store structure, required package or immutable index', async t => {
  for (const mutation of ['files', 'manifest', 'index']) {
    await t.test(mutation, async child => {
      const source = await fixture(child)
      await chmodTree(source.configuredRoot, 0o755, 0o644)
      if (mutation === 'files') await rm(join(source.configuredRoot, 'v11', 'files'), { recursive: true })
      if (mutation === 'manifest') await writeFile(join(source.filesRoot, 'manifest'), '{"name":"other","version":"1.0.0"}\n')
      if (mutation === 'index') await rm(join(source.configuredRoot, 'v11', 'index.db'))
      await chmodTree(source.configuredRoot, 0o555, 0o444)
      await assert.rejects(
        verifyPnpmOfflineStore(options(source)),
        /files root is missing|incomplete for the locked enterprise Worker dependency closure|index database is missing/u,
      )
    })
  }
})

test('fails closed on writable entries, symlinks, content drift and a malformed seal', async t => {
  const source = await fixture(t)
  await chmod(source.filesRoot, 0o755)
  await assert.rejects(verifyPnpmOfflineStore(options(source)), /writable entry/u)
  await chmod(source.filesRoot, 0o555)

  await chmod(source.filesRoot, 0o755)
  await symlink('content', join(source.filesRoot, 'linked-content'))
  await chmod(source.filesRoot, 0o555)
  await assert.rejects(verifyPnpmOfflineStore(options(source)), /symbolic link/u)
  await chmod(source.filesRoot, 0o755)
  await rm(join(source.filesRoot, 'linked-content'))
  await chmod(source.filesRoot, 0o555)

  const seal = await verifyPnpmOfflineStore(options(source))
  const sealPath = join(source.temporaryRoot, 'seal.json')
  await writeFile(sealPath, `${JSON.stringify(seal)}\n`)
  await chmod(source.filesRoot, 0o755)
  await chmod(join(source.filesRoot, 'content'), 0o644)
  await writeFile(join(source.filesRoot, 'content'), 'drift')
  await chmod(join(source.filesRoot, 'content'), 0o444)
  await chmod(source.filesRoot, 0o555)
  await assert.rejects(
    verifyPnpmOfflineStore(options(source, { expectedSealPath: sealPath })),
    /content changed after its trusted fetch seal/u,
  )

  await writeFile(sealPath, '{"status":"PASS"}\n')
  await assert.rejects(
    verifyPnpmOfflineStore(options(source, { expectedSealPath: sealPath })),
    /not a valid locked pnpm offline-store receipt/u,
  )

  await writeFile(sealPath, `${JSON.stringify({
    ...seal,
    rootContractDigest: `sha256:${'0'.repeat(64)}`,
  })}\n`)
  await assert.rejects(
    verifyPnpmOfflineStore(options(source, { expectedSealPath: sealPath })),
    /not a valid locked pnpm offline-store receipt/u,
  )
})

test('opens every Store file without following links and rejects hard-linked or special entries without a seal', async t => {
  await t.test('hard link with nlink greater than one', async child => {
    const source = await fixture(child)
    const contentPath = join(source.filesRoot, 'content')
    await mutateStoreFile(source, () => link(contentPath, join(source.filesRoot, 'content-hardlink')))
    assert.equal((await lstat(contentPath)).nlink, 2)
    await rejectWithoutSeal(source, /may not be hard-linked/u)
  })

  await t.test('unknown Unix socket entry', async child => {
    const source = await fixture(child, '/tmp/paimind-store-')
    const socketPath = join(source.filesRoot, 'unsupported.sock')
    const server = createServer()
    await chmod(source.filesRoot, 0o755)
    await new Promise((resolveListen, rejectListen) => {
      server.once('error', rejectListen)
      server.listen(socketPath, resolveListen)
    })
    await chmod(source.filesRoot, 0o555)
    try {
      await rejectWithoutSeal(source, /unsupported file type/u)
    } finally {
      await new Promise(resolveClose => server.close(resolveClose))
    }
  })
})

test('fails closed when a Store file changes after its no-follow open and initial fstat', async t => {
  for (const mutation of ['symlink-retarget', 'content-drift', 'identity-drift']) {
    await t.test(mutation, async child => {
      const source = await fixture(child)
      const contentPath = join(source.filesRoot, 'content')
      const canonicalContentPath = await realpath(contentPath)
      const originalContents = Buffer.from('locked-package-content', 'utf8')
      let mutated = false
      const phase = mutation === 'content-drift' ? 'afterInitialFileStat' : 'afterFileRead'
      const hooks = {
        async [phase]({ path }) {
          if (path !== canonicalContentPath || mutated) return
          mutated = true
          await mutateStoreFile(source, async () => {
            if (mutation === 'symlink-retarget') {
              await rename(contentPath, join(source.filesRoot, 'content-original'))
              await symlink('content-original', contentPath)
              return
            }
            if (mutation === 'identity-drift') {
              await rename(contentPath, join(source.filesRoot, 'content-original'))
              await writeFile(contentPath, originalContents)
              await chmod(contentPath, 0o444)
              return
            }
            await chmod(contentPath, 0o644)
            await writeFile(contentPath, Buffer.alloc(originalContents.length, 'x'))
            await chmod(contentPath, 0o444)
          })
        },
      }
      await rejectWithoutSeal(source, /changed|regular file/u, hooks)
      assert.equal(mutated, true)
    })
  }
})

test('keeps a missing configured Store as a fail-closed root-contract error', async t => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'paimind-offline-store-missing-'))
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }))
  await assert.rejects(
    verifyPnpmOfflineStore({ configuredRoot: join(temporaryRoot, 'missing') }),
    /configured root is missing/u,
  )
})
