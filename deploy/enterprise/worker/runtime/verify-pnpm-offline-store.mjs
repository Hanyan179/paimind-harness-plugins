#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { lstat, open, opendir, realpath, unlink } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  WORKER_BUILD_ROOT_CONTRACT,
  WORKER_BUILD_ROOT_CONTRACT_DIGEST,
} from './worker-build-root-contract.mjs'
import { requirePnpmProjectRegistryNormalizationReceipt } from './normalize-pnpm-project-registry.mjs'

export const WORKER_OFFLINE_STORE_CONTRACT = Object.freeze({
  schemaVersion: 1,
  packageManager: 'pnpm@11.7.0',
  configuredRoot: WORKER_BUILD_ROOT_CONTRACT.roots.store.path,
  versionDirectory: 'v11',
  requiredPackage: Object.freeze({ name: '@deepseek-ai/dsh-home-paths', version: '0.1.1-rc.2' }),
})

const DIGEST = /^sha256:[a-f0-9]{64}$/u
const NO_FOLLOW = fsConstants.O_NOFOLLOW ?? 0
const MAX_SEAL_BYTES = 256 * 1_024
const MAX_MANIFEST_BYTES = 1 * 1_024 * 1_024
const STORE_FILE_SCAN_CONCURRENCY = 32

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function isWithin(root, candidate) {
  const path = relative(root, candidate)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

function identity(root, path) {
  return relative(root, path).split(sep).join('/') || '.'
}

function hasExactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0')
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino
}

function sameFileSnapshot(left, right) {
  return sameFileIdentity(left, right)
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.uid === right.uid
    && left.gid === right.gid
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs
}

function assertPrivateRegularFile(metadata, label, constraints) {
  if (!metadata.isFile()) throw new Error(`${label} must be a regular file`)
  if (metadata.nlink !== 1n) throw new Error(`${label} may not be hard-linked`)
  if (constraints.requiredOwnerUid !== undefined && metadata.uid !== BigInt(constraints.requiredOwnerUid)) {
    throw new Error(`${label} has an unexpected owner`)
  }
  if (constraints.requireImmutableMode === true && (metadata.mode & 0o222n) !== 0n) {
    throw new Error(`${label} is writable`)
  }
  if (metadata.size < BigInt(constraints.minimumBytes ?? 0)
    || (constraints.maximumBytes !== undefined && metadata.size > BigInt(constraints.maximumBytes))) {
    throw new Error(`${label} must be one bounded private regular file`)
  }
}

async function readStableRegularNoFollow(path, label, constraints = {}, testHooks) {
  let handle
  try {
    handle = await open(path, fsConstants.O_RDONLY | NO_FOLLOW)
    const before = await handle.stat({ bigint: true })
    assertPrivateRegularFile(before, label, constraints)
    const pathBefore = await lstat(path, { bigint: true })
    assertPrivateRegularFile(pathBefore, label, constraints)
    if (!sameFileIdentity(before, pathBefore)) {
      throw new Error(`${label} changed identity while being verified`)
    }
    await testHooks?.afterInitialFileStat?.(Object.freeze({ path, label }))
    const contents = await handle.readFile()
    await testHooks?.afterFileRead?.(Object.freeze({ path, label }))
    const after = await handle.stat({ bigint: true })
    assertPrivateRegularFile(after, label, constraints)
    let pathAfter
    try {
      pathAfter = await lstat(path, { bigint: true })
    } catch (error) {
      if (error?.code === 'ENOENT') throw new Error(`${label} changed identity while being verified`)
      throw error
    }
    assertPrivateRegularFile(pathAfter, label, constraints)
    if (!sameFileSnapshot(before, after)
      || !sameFileIdentity(after, pathAfter)
      || BigInt(contents.byteLength) !== after.size) {
      throw new Error(`${label} changed while being verified`)
    }
    return contents
  } catch (error) {
    if (error?.code === 'ELOOP') throw new Error(`${label} may not be a symbolic link`)
    throw error
  } finally {
    await handle?.close()
  }
}

async function assertReadOnlyMount(root) {
  const probe = join(root, `.paimind-read-only-probe-${process.pid}`)
  let handle
  try {
    handle = await open(probe, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600)
    await handle.close()
    handle = undefined
    await unlink(probe)
    throw new Error('pnpm offline store mount remained writable to the build consumer')
  } catch (error) {
    await handle?.close()
    if (error?.code === 'EROFS' || error?.code === 'EACCES' || error?.code === 'EPERM') return true
    throw error
  }
}

async function mapBounded(values, concurrency, mapper) {
  const results = new Array(values.length)
  let cursor = 0
  async function worker() {
    while (cursor < values.length) {
      const index = cursor
      cursor += 1
      results[index] = await mapper(values[index])
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    () => worker(),
  )
  await Promise.all(workers)
  return results
}

async function scanStore(configuredRoot, options, testHooks) {
  const records = []
  const filePaths = []
  const pending = [configuredRoot]
  const visited = new Set()
  let files = 0
  let directories = 0
  let bytes = 0
  let requiredPackageManifestMatches = 0
  while (pending.length > 0) {
    const path = pending.pop()
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink()) throw new Error(`pnpm offline store contains a symbolic link: ${basename(path)}`)
    if (metadata.isDirectory()) {
      if (options.requiredOwnerUid !== undefined && metadata.uid !== options.requiredOwnerUid) {
        throw new Error('pnpm offline store contains an entry with an unexpected owner')
      }
      if (options.requireImmutableModes === true && (metadata.mode & 0o222) !== 0) {
        throw new Error('pnpm offline store contains a writable entry')
      }
      const canonical = await realpath(path)
      if (!isWithin(configuredRoot, canonical)) throw new Error('pnpm offline store directory escapes its configured root')
      if (visited.has(canonical)) continue
      visited.add(canonical)
      directories += 1
      records.push(`d\0${identity(configuredRoot, path)}`)
      const names = []
      const directory = await opendir(path)
      for await (const entry of directory) names.push(entry.name)
      names.sort().reverse()
      for (const name of names) pending.push(join(path, name))
      continue
    }
    if (!metadata.isFile()) throw new Error('pnpm offline store contains an unsupported file type')
    filePaths.push(path)
  }
  const fileRecords = await mapBounded(filePaths, STORE_FILE_SCAN_CONCURRENCY, async path => {
    const contents = await readStableRegularNoFollow(path, 'pnpm offline store file', {
      requiredOwnerUid: options.requiredOwnerUid,
      requireImmutableMode: options.requireImmutableModes,
    }, testHooks)
    let requiredPackageManifestMatch = 0
    if (contents.byteLength <= MAX_MANIFEST_BYTES
      && contents.includes(Buffer.from(WORKER_OFFLINE_STORE_CONTRACT.requiredPackage.name, 'utf8'))) {
      try {
        const manifest = JSON.parse(contents.toString('utf8'))
        if (manifest?.name === WORKER_OFFLINE_STORE_CONTRACT.requiredPackage.name
          && manifest?.version === WORKER_OFFLINE_STORE_CONTRACT.requiredPackage.version) {
          requiredPackageManifestMatch = 1
        }
      } catch {
        // Content-addressed package files may contain the package name without
        // being manifests. Only exact parseable package identities count.
      }
    }
    return Object.freeze({
      bytes: contents.byteLength,
      record: `f\0${identity(configuredRoot, path)}\0${sha256(contents)}`,
      requiredPackageManifestMatch,
    })
  })
  for (const file of fileRecords) {
    files += 1
    bytes += file.bytes
    records.push(file.record)
    requiredPackageManifestMatches += file.requiredPackageManifestMatch
  }
  records.sort()
  if (files < 1 || directories < 3 || bytes < 1 || requiredPackageManifestMatches < 1) {
    throw new Error('pnpm offline store is incomplete for the locked enterprise Worker dependency closure')
  }
  return Object.freeze({
    files,
    directories,
    bytes,
    contentDigest: sha256(Buffer.from(records.join('\n'), 'utf8')),
    requiredPackageManifestMatches,
  })
}

function requireSeal(value, label) {
  if (!hasExactKeys(value, [
    'schemaVersion', 'status', 'packageManager', 'rootContractDigest', 'configuredRootDigest', 'versionDirectory',
    'files', 'directories', 'bytes', 'contentDigest', 'requiredPackage',
    'requiredPackageManifestMatches', 'immutableModes', 'readOnlyMount',
  ])
    || value.schemaVersion !== 1 || value.status !== 'PASS'
    || value.packageManager !== WORKER_OFFLINE_STORE_CONTRACT.packageManager
    || value.rootContractDigest !== WORKER_BUILD_ROOT_CONTRACT_DIGEST
    || value.configuredRootDigest !== sha256(Buffer.from(WORKER_OFFLINE_STORE_CONTRACT.configuredRoot, 'utf8'))
    || value.versionDirectory !== WORKER_OFFLINE_STORE_CONTRACT.versionDirectory
    || !Number.isSafeInteger(value.files) || value.files < 1
    || !Number.isSafeInteger(value.directories) || value.directories < 3
    || !Number.isSafeInteger(value.bytes) || value.bytes < 1
    || !DIGEST.test(value.contentDigest)
    || !hasExactKeys(value.requiredPackage, ['name', 'version'])
    || value.requiredPackage.name !== WORKER_OFFLINE_STORE_CONTRACT.requiredPackage.name
    || value.requiredPackage.version !== WORKER_OFFLINE_STORE_CONTRACT.requiredPackage.version
    || !Number.isSafeInteger(value.requiredPackageManifestMatches) || value.requiredPackageManifestMatches < 1
    || value.immutableModes !== true || typeof value.readOnlyMount !== 'boolean') {
    throw new Error(`${label} is not a valid locked pnpm offline-store receipt`)
  }
  return value
}

// A policy-probe build is not an application install or deploy. Keep its
// receipts distinct so preliminary evidence cannot satisfy the final gate.
export function composePnpmOfflineStorePolicyEvidence(receipts) {
  if (!hasExactKeys(receipts, ['normalization', 'seal', 'policyBefore', 'policyAfter'])) {
    throw new Error('pnpm offline store policy receipt set is invalid')
  }
  const normalization = requirePnpmProjectRegistryNormalizationReceipt(receipts.normalization)
  const seal = requireSeal(receipts.seal, 'pnpm offline store seal')
  if (seal.readOnlyMount !== false || normalization.storeRootDigest !== seal.configuredRootDigest
    || normalization.rootContractDigest !== seal.rootContractDigest) {
    throw new Error('pnpm offline store policy seal does not match the producer contract')
  }
  for (const name of ['policyBefore', 'policyAfter']) {
    const value = requireSeal(receipts[name], `pnpm offline store ${name}`)
    if (value.readOnlyMount !== true || Object.keys(seal).some(key => key !== 'readOnlyMount'
      && JSON.stringify(value[key]) !== JSON.stringify(seal[key]))) {
      throw new Error('pnpm offline store policy consumer changed or lost its read-only contract')
    }
  }
  return Object.freeze({
    schemaVersion: 1, status: 'PASS', evidenceRole: 'policy-probes-only',
    packageManager: seal.packageManager, rootContractDigest: seal.rootContractDigest,
    contentDigest: seal.contentDigest, files: seal.files, bytes: seal.bytes,
    unchangedAfterPolicyProbes: true, readOnlyConsumers: Object.freeze(['policy-before', 'policy-after']),
    finalWorkerImageAccepted: false,
  })
}

export function composePnpmOfflineStoreConsumptionEvidence(receipts) {
  if (!hasExactKeys(receipts, ['normalization', 'seal', 'installBefore', 'installAfter', 'deployBefore', 'deployAfter'])) {
    throw new Error('pnpm offline store consumption receipt set is invalid')
  }
  const normalization = requirePnpmProjectRegistryNormalizationReceipt(
    receipts.normalization,
    'pnpm offline store Project Registry normalization receipt',
  )
  const entries = ['seal', 'installBefore', 'installAfter', 'deployBefore', 'deployAfter']
    .map(name => [name, requireSeal(receipts[name], `pnpm offline store ${name}`)])
  const baseline = entries[0][1]
  if (normalization.packageManager !== baseline.packageManager
    || normalization.rootContractDigest !== baseline.rootContractDigest
    || normalization.storeRootDigest !== baseline.configuredRootDigest) {
    throw new Error('pnpm Project Registry normalization does not match the sealed offline Store contract')
  }
  for (const [name, value] of entries) {
    if (value.rootContractDigest !== baseline.rootContractDigest
      || value.configuredRootDigest !== baseline.configuredRootDigest
      || value.contentDigest !== baseline.contentDigest
      || value.files !== baseline.files || value.directories !== baseline.directories || value.bytes !== baseline.bytes
      || value.requiredPackageManifestMatches !== baseline.requiredPackageManifestMatches
      || value.immutableModes !== true
      || (name === 'seal' ? value.readOnlyMount !== false : value.readOnlyMount !== true)) {
      throw new Error('pnpm offline store changed or lost its immutable read-only consumer contract')
    }
  }
  return Object.freeze({
    schemaVersion: 1,
    status: 'PASS',
    packageManager: baseline.packageManager,
    rootContractDigest: baseline.rootContractDigest,
    configuredRootDigest: baseline.configuredRootDigest,
    versionDirectory: baseline.versionDirectory,
    files: baseline.files,
    directories: baseline.directories,
    bytes: baseline.bytes,
    contentDigest: baseline.contentDigest,
    requiredPackage: baseline.requiredPackage,
    requiredPackageManifestMatches: baseline.requiredPackageManifestMatches,
    immutableModes: true,
    projectRegistryNormalization: normalization,
    readOnlyConsumers: Object.freeze(['install-before', 'install-after', 'deploy-before', 'deploy-after']),
    unchangedAfterConsumers: true,
    consumerNetworkPolicy: 'buildkit-network-none-required',
    hostStoreDependency: false,
  })
}

export async function verifyPnpmOfflineStore(options = {}, testHooks) {
  if (typeof options.configuredRoot !== 'string' || !isAbsolute(options.configuredRoot)) {
    throw new Error('pnpm offline store configured root must be absolute')
  }
  const configuredRoot = resolve(options.configuredRoot)
  if (options.enforceLockedRoot === true && configuredRoot !== WORKER_OFFLINE_STORE_CONTRACT.configuredRoot) {
    throw new Error('pnpm offline store configured root does not match the locked Worker root contract')
  }
  const rootMetadata = await lstat(configuredRoot).catch(error => {
    if (error?.code === 'ENOENT') throw new Error('pnpm offline store configured root is missing')
    throw error
  })
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error('pnpm offline store configured root must be a real directory')
  }
  const canonicalRoot = await realpath(configuredRoot)
  if (options.enforceLockedRoot === true && canonicalRoot !== configuredRoot) {
    throw new Error('pnpm offline store configured root may not alias another path')
  }
  const versionRoot = join(configuredRoot, WORKER_OFFLINE_STORE_CONTRACT.versionDirectory)
  const filesRoot = join(versionRoot, 'files')
  for (const [path, label] of [[versionRoot, 'version root'], [filesRoot, 'content-addressed files root']]) {
    const metadata = await lstat(path).catch(error => {
      if (error?.code === 'ENOENT') throw new Error(`pnpm offline store ${label} is missing`)
      throw error
    })
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || !isWithin(canonicalRoot, await realpath(path))) {
      throw new Error(`pnpm offline store ${label} must be a contained real directory`)
    }
  }
  const indexPath = join(versionRoot, 'index.db')
  const indexMetadata = await lstat(indexPath).catch(error => {
    if (error?.code === 'ENOENT') throw new Error('pnpm offline store immutable index database is missing')
    throw error
  })
  if (!indexMetadata.isFile() || indexMetadata.isSymbolicLink() || indexMetadata.nlink !== 1 || indexMetadata.size < 1) {
    throw new Error('pnpm offline store immutable index database must be one non-empty private regular file')
  }
  const scanned = await scanStore(canonicalRoot, options, testHooks)
  let expectedSeal
  if (options.expectedSealPath !== undefined) {
    if (typeof options.expectedSealPath !== 'string' || !isAbsolute(options.expectedSealPath)) {
      throw new Error('pnpm offline store expected seal path must be absolute')
    }
    let parsed
    try {
      parsed = JSON.parse((await readStableRegularNoFollow(
        resolve(options.expectedSealPath),
        'pnpm offline store expected seal',
        { minimumBytes: 1, maximumBytes: MAX_SEAL_BYTES },
        testHooks,
      )).toString('utf8'))
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error('pnpm offline store expected seal is not valid JSON')
      throw error
    }
    expectedSeal = requireSeal(parsed, 'pnpm offline store expected seal')
    if (expectedSeal.files !== scanned.files || expectedSeal.directories !== scanned.directories
      || expectedSeal.bytes !== scanned.bytes || expectedSeal.contentDigest !== scanned.contentDigest
      || expectedSeal.requiredPackageManifestMatches !== scanned.requiredPackageManifestMatches) {
      throw new Error('pnpm offline store content changed after its trusted fetch seal')
    }
  }
  const readOnlyMount = options.requireReadOnlyMount === true
    ? await assertReadOnlyMount(canonicalRoot)
    : false
  return Object.freeze({
    schemaVersion: 1,
    status: 'PASS',
    packageManager: WORKER_OFFLINE_STORE_CONTRACT.packageManager,
    rootContractDigest: WORKER_BUILD_ROOT_CONTRACT_DIGEST,
    configuredRootDigest: sha256(Buffer.from(WORKER_OFFLINE_STORE_CONTRACT.configuredRoot, 'utf8')),
    versionDirectory: WORKER_OFFLINE_STORE_CONTRACT.versionDirectory,
    files: scanned.files,
    directories: scanned.directories,
    bytes: scanned.bytes,
    contentDigest: scanned.contentDigest,
    requiredPackage: WORKER_OFFLINE_STORE_CONTRACT.requiredPackage,
    requiredPackageManifestMatches: scanned.requiredPackageManifestMatches,
    immutableModes: options.requireImmutableModes === true,
    readOnlyMount,
  })
}

function parseArguments(argv) {
  let configuredRoot
  let expectedSealPath
  let requireReadOnlyMount = false
  for (const argument of argv) {
    if (argument.startsWith('--expected-seal=')) expectedSealPath = argument.slice('--expected-seal='.length)
    else if (argument === '--require-read-only-mount') requireReadOnlyMount = true
    else if (configuredRoot === undefined) configuredRoot = argument
    else throw new Error('pnpm offline store verifier received an unknown argument')
  }
  if (configuredRoot === undefined) throw new Error('usage: verify-pnpm-offline-store.mjs <configured-store-root> [--expected-seal=<path>] [--require-read-only-mount]')
  return Object.freeze({
    configuredRoot,
    expectedSealPath,
    requireImmutableModes: true,
    requireReadOnlyMount,
    enforceLockedRoot: true,
    requiredOwnerUid: 0,
  })
}

const modulePath = await realpath(fileURLToPath(import.meta.url))
const invoked = process.argv[1] !== undefined
  && await realpath(resolve(process.argv[1])).catch(() => undefined) === modulePath
if (invoked) {
  try {
    const result = await verifyPnpmOfflineStore(parseArguments(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } catch (error) {
    process.stderr.write(`pnpm offline store verification failed: ${error instanceof Error ? error.message : 'unknown error'}\n`)
    process.exitCode = 1
  }
}
