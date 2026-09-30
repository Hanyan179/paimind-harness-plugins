#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { lstat, opendir, readlink, realpath, readdir, rmdir, unlink } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  WORKER_BUILD_ROOT_CONTRACT,
  WORKER_BUILD_ROOT_CONTRACT_DIGEST,
} from './worker-build-root-contract.mjs'

const PACKAGE_MANAGER = 'pnpm@11.7.0'
const POLICY = 'pnpm-v11-project-registry-exact-link-removal-v1'
const EVIDENCE_ROLE = 'pre-seal-generated-metadata-removal'
const VERSION_DIRECTORY = 'v11'
const PROJECTS_DIRECTORY = 'projects'
const PROJECT_ID = /^[a-f0-9]{32}$/u
const UTF8 = new TextDecoder('utf-8', { fatal: true })
const RECEIPT_KEYS = Object.freeze([
  'schemaVersion',
  'status',
  'packageManager',
  'policy',
  'evidenceRole',
  'rootContractDigest',
  'sourceRootDigest',
  'storeRootDigest',
  'registryPathDigest',
  'linkTargetDigest',
  'removedEntries',
  'unexpectedEntries',
  'residualSymlinks',
  'registryDirectoryRemoved',
])

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function shortHash(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 32)
}

function lockedReceiptValues() {
  const sourceRoot = WORKER_BUILD_ROOT_CONTRACT.roots.source.path
  const storeRoot = WORKER_BUILD_ROOT_CONTRACT.roots.store.path
  const projectsRoot = join(storeRoot, VERSION_DIRECTORY, PROJECTS_DIRECTORY)
  const registryPath = `${VERSION_DIRECTORY}/${PROJECTS_DIRECTORY}/${shortHash(Buffer.from(sourceRoot, 'utf8'))}`
  const linkTarget = relative(projectsRoot, sourceRoot)
  return {
    schemaVersion: 1,
    status: 'PASS',
    packageManager: PACKAGE_MANAGER,
    policy: POLICY,
    evidenceRole: EVIDENCE_ROLE,
    rootContractDigest: WORKER_BUILD_ROOT_CONTRACT_DIGEST,
    sourceRootDigest: sha256(Buffer.from(sourceRoot, 'utf8')),
    storeRootDigest: sha256(Buffer.from(storeRoot, 'utf8')),
    registryPathDigest: sha256(Buffer.from(registryPath, 'utf8')),
    linkTargetDigest: sha256(Buffer.from(linkTarget, 'utf8')),
    removedEntries: 1,
    unexpectedEntries: 0,
    residualSymlinks: 0,
    registryDirectoryRemoved: true,
  }
}

function hasExactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0')
}

export function requirePnpmProjectRegistryNormalizationReceipt(
  value,
  label = 'pnpm Project Registry normalization receipt',
) {
  const expected = lockedReceiptValues()
  if (!hasExactKeys(value, RECEIPT_KEYS)
    || RECEIPT_KEYS.some(key => value[key] !== expected[key])) {
    throw new Error(`${label} does not match the locked pnpm Project Registry normalization contract`)
  }
  return Object.freeze(Object.fromEntries(RECEIPT_KEYS.map(key => [key, expected[key]])))
}

function isWithin(root, candidate) {
  const path = relative(root, candidate)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

function logicalIdentity(root, path) {
  return relative(root, path).split(sep).join('/') || '.'
}

function metadataIdentity(metadata) {
  return [
    metadata.dev,
    metadata.ino,
    metadata.mode,
    metadata.uid,
    metadata.gid,
    metadata.nlink,
    metadata.size,
    metadata.mtimeNs,
    metadata.ctimeNs,
  ].map(value => value.toString()).join(':')
}

export function assertPnpmProjectRegistryLinkMetadata(metadata, requiredOwnerUid) {
  if (metadata === null || typeof metadata !== 'object' || typeof metadata.isSymbolicLink !== 'function'
    || !metadata.isSymbolicLink()) {
    throw new Error('pnpm Project Registry entry must be a symbolic link')
  }
  if (metadata.uid !== BigInt(requiredOwnerUid)) {
    throw new Error('pnpm Project Registry link has an unexpected owner')
  }
  if (metadata.nlink !== 1n) {
    throw new Error('pnpm Project Registry link must have exactly one link')
  }
  return true
}

async function inspectRealRoot(path, label, requiredOwnerUid) {
  let metadata
  try {
    metadata = await lstat(path, { bigint: true })
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`${label} is missing`)
    throw error
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory`)
  }
  if (metadata.uid !== BigInt(requiredOwnerUid)) {
    throw new Error(`${label} has an unexpected owner`)
  }
  const canonical = await realpath(path)
  if (canonical !== path) throw new Error(`${label} may not alias another path`)
  return Object.freeze({ metadata, canonical })
}

async function scanStore(storeRoot, requiredOwnerUid) {
  const pending = [storeRoot]
  const records = []
  const symlinks = []
  while (pending.length > 0) {
    const path = pending.pop()
    const metadata = await lstat(path, { bigint: true })
    if (metadata.uid !== BigInt(requiredOwnerUid)) {
      throw new Error('pnpm Store contains an entry with an unexpected owner')
    }
    const identity = logicalIdentity(storeRoot, path)
    if (metadata.isSymbolicLink()) {
      assertPnpmProjectRegistryLinkMetadata(metadata, requiredOwnerUid)
      const rawTarget = await readlink(path, { encoding: 'buffer' })
      const afterRead = await lstat(path, { bigint: true })
      if (metadataIdentity(afterRead) !== metadataIdentity(metadata)) {
        throw new Error('pnpm Store symbolic link changed during inspection')
      }
      symlinks.push(Object.freeze({ path, metadata, rawTarget }))
      records.push(`l\0${identity}\0${metadataIdentity(metadata)}\0${sha256(rawTarget)}`)
      continue
    }
    if (metadata.isDirectory()) {
      const canonical = await realpath(path)
      if (!isWithin(storeRoot, canonical) || canonical !== path) {
        throw new Error('pnpm Store directory escapes or aliases its locked root')
      }
      records.push(`d\0${identity}\0${metadataIdentity(metadata)}`)
      const names = []
      const directory = await opendir(path)
      for await (const entry of directory) names.push(entry.name)
      names.sort().reverse()
      for (const name of names) pending.push(join(path, name))
      continue
    }
    if (metadata.isFile()) {
      if (metadata.nlink !== 1n) throw new Error('pnpm Store contains a hard-linked regular file')
      records.push(`f\0${identity}\0${metadataIdentity(metadata)}`)
      continue
    }
    throw new Error('pnpm Store contains an unsupported file type')
  }
  records.sort()
  return Object.freeze({
    identityDigest: sha256(Buffer.from(records.join('\n'), 'utf8')),
    symlinks: Object.freeze(symlinks),
  })
}

function decodeTarget(rawTarget) {
  if (!Buffer.isBuffer(rawTarget) || rawTarget.byteLength < 1 || rawTarget.includes(0)) {
    throw new Error('pnpm Project Registry link target is empty or malformed')
  }
  try {
    return UTF8.decode(rawTarget)
  } catch {
    throw new Error('pnpm Project Registry link target is not valid UTF-8')
  }
}

async function inspectRegistry(options) {
  const {
    sourceRoot,
    storeRoot,
    requiredOwnerUid,
    expectedProjectId,
    projectsRoot,
    expectedLinkPath,
  } = options
  const source = await inspectRealRoot(sourceRoot, 'locked Worker build source root', requiredOwnerUid)
  await inspectRealRoot(storeRoot, 'locked Worker pnpm Store root', requiredOwnerUid)
  const projects = await inspectRealRoot(projectsRoot, 'pnpm Project Registry directory', requiredOwnerUid)
  if (!isWithin(storeRoot, projects.canonical)) {
    throw new Error('pnpm Project Registry directory escapes the locked Store root')
  }

  const names = (await readdir(projectsRoot)).sort()
  if (names.length !== 1 || names[0] !== expectedProjectId || !PROJECT_ID.test(names[0] ?? '')) {
    throw new Error('pnpm Project Registry must contain exactly the locked Worker source entry')
  }

  const store = await scanStore(storeRoot, requiredOwnerUid)
  if (store.symlinks.length !== 1 || store.symlinks[0].path !== expectedLinkPath) {
    throw new Error('pnpm Store may contain only the locked Project Registry symbolic link')
  }
  const link = store.symlinks[0]
  const rawTarget = decodeTarget(link.rawTarget)
  if (isAbsolute(rawTarget)) throw new Error('pnpm Project Registry link target must be relative')
  const expectedRawTarget = relative(projectsRoot, sourceRoot)
  if (rawTarget !== expectedRawTarget || resolve(projectsRoot, rawTarget) !== sourceRoot) {
    throw new Error('pnpm Project Registry link target does not exactly match the locked Worker source root')
  }
  let canonicalTarget
  try {
    canonicalTarget = await realpath(expectedLinkPath)
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ELOOP') {
      throw new Error('pnpm Project Registry link target is dangling or chained')
    }
    throw error
  }
  if (canonicalTarget !== source.canonical) {
    throw new Error('pnpm Project Registry canonical target does not match the locked Worker source root')
  }
  const afterTarget = await lstat(expectedLinkPath, { bigint: true })
  if (!afterTarget.isSymbolicLink() || metadataIdentity(afterTarget) !== metadataIdentity(link.metadata)) {
    throw new Error('pnpm Project Registry link changed during target validation')
  }
  return Object.freeze({
    sourceMetadata: source.metadata,
    projectsMetadata: projects.metadata,
    link,
    rawTarget,
    identityDigest: store.identityDigest,
  })
}

function normalizeOptions(options) {
  if (options === null || typeof options !== 'object') {
    throw new Error('pnpm Project Registry normalization options must be an object')
  }
  const enforceLockedRoots = options.enforceLockedRoots !== false
  const sourceRoot = resolve(options.sourceRoot ?? WORKER_BUILD_ROOT_CONTRACT.roots.source.path)
  const storeRoot = resolve(options.storeRoot ?? WORKER_BUILD_ROOT_CONTRACT.roots.store.path)
  if (enforceLockedRoots
    && (sourceRoot !== WORKER_BUILD_ROOT_CONTRACT.roots.source.path
      || storeRoot !== WORKER_BUILD_ROOT_CONTRACT.roots.store.path)) {
    throw new Error('pnpm Project Registry roots do not match the locked Worker build root contract')
  }
  const requiredOwnerUid = options.requiredOwnerUid ?? 0
  if (!Number.isSafeInteger(requiredOwnerUid) || requiredOwnerUid < 0) {
    throw new Error('pnpm Project Registry required owner UID must be a non-negative safe integer')
  }
  if (options.beforeCommit !== undefined && typeof options.beforeCommit !== 'function') {
    throw new Error('pnpm Project Registry beforeCommit hook must be a function')
  }
  if (options.afterValidationBeforeCommit !== undefined && typeof options.afterValidationBeforeCommit !== 'function') {
    throw new Error('pnpm Project Registry afterValidationBeforeCommit hook must be a function')
  }
  const expectedProjectId = shortHash(Buffer.from(sourceRoot, 'utf8'))
  const projectsRoot = join(storeRoot, VERSION_DIRECTORY, PROJECTS_DIRECTORY)
  const expectedLinkPath = join(projectsRoot, expectedProjectId)
  return Object.freeze({
    sourceRoot,
    storeRoot,
    requiredOwnerUid,
    expectedProjectId,
    projectsRoot,
    expectedLinkPath,
    beforeCommit: options.beforeCommit,
    afterValidationBeforeCommit: options.afterValidationBeforeCommit,
  })
}

function assertUnchangedRegistry(baseline, candidate) {
  if (candidate.identityDigest !== baseline.identityDigest
    || metadataIdentity(candidate.sourceMetadata) !== metadataIdentity(baseline.sourceMetadata)
    || metadataIdentity(candidate.projectsMetadata) !== metadataIdentity(baseline.projectsMetadata)
    || metadataIdentity(candidate.link.metadata) !== metadataIdentity(baseline.link.metadata)
    || !candidate.link.rawTarget.equals(baseline.link.rawTarget)) {
    throw new Error('pnpm Project Registry changed before normalization commit')
  }
}

export async function normalizePnpmProjectRegistry(options = {}) {
  const normalized = normalizeOptions(options)
  const first = await inspectRegistry(normalized)
  await normalized.beforeCommit?.()
  const second = await inspectRegistry(normalized)
  assertUnchangedRegistry(first, second)
  await normalized.afterValidationBeforeCommit?.()
  const commit = await inspectRegistry(normalized)
  assertUnchangedRegistry(second, commit)

  await unlink(normalized.expectedLinkPath)
  await rmdir(normalized.projectsRoot)

  const post = await scanStore(normalized.storeRoot, normalized.requiredOwnerUid)
  if (post.symlinks.length !== 0) {
    throw new Error('pnpm Store retains a symbolic link after Project Registry normalization')
  }
  return requirePnpmProjectRegistryNormalizationReceipt(lockedReceiptValues())
}

function parseArguments(argv) {
  if (!Array.isArray(argv) || argv.length !== 0) {
    throw new Error('pnpm Project Registry normalizer does not accept command-line arguments')
  }
  return Object.freeze({})
}

const modulePath = await realpath(fileURLToPath(import.meta.url))
const invoked = process.argv[1] !== undefined
  && await realpath(resolve(process.argv[1])).catch(() => undefined) === modulePath
if (invoked) {
  try {
    const result = await normalizePnpmProjectRegistry(parseArguments(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } catch (error) {
    process.stderr.write(`pnpm Project Registry normalization failed: ${error instanceof Error ? error.message : 'unknown error'}\n`)
    process.exitCode = 1
  }
}
