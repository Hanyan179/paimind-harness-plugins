#!/usr/bin/env node

import { constants as fsConstants } from 'node:fs'
import { lstat, open, opendir, readFile, readdir, readlink, realpath, rename, rm, unlink } from 'node:fs/promises'
import { basename, delimiter, dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const GENERATED_ARTIFACT = /(?:\.d\.(?:ts|mts|cts)|\.map)$/u
const PNPM_PACKAGE_MANAGER = 'pnpm@11.7.0'
const PNPM_RUNTIME_ROOT = '/opt/paimind'
const PNPM_INSTALL_STATE = Object.freeze(['node_modules', '.modules.yaml'])
const MAX_PNPM_INSTALL_STATE_BYTES = 4 * 1_024 * 1_024
const MAX_PNPM_COMMAND_SHIM_BYTES = 256 * 1_024
const LEGACY_DEPLOY_SELF_LINK = Object.freeze([
  'node_modules', '.pnpm', 'node_modules', '@paimind', 'enterprise-worker-runtime',
])
const NODE_PTY_BUILD_ROOT = Object.freeze([
  'node_modules', '.pnpm', 'node-pty@1.1.0', 'node_modules', 'node-pty', 'build',
])
const NO_FOLLOW = fsConstants.O_NOFOLLOW ?? 0
let normalizationSequence = 0

function isWithin(root, candidate) {
  const path = relative(root, candidate)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

async function containedTarget(root, path) {
  let target
  try { target = await realpath(path) } catch (error) {
    throw new Error(`runtime link ${basename(path)} is dangling, cyclic or unreadable`, { cause: error })
  }
  if (!isWithin(root, target)) throw new Error(`runtime link ${basename(path)} escapes the deployed runtime tree`)
  return target
}

async function readRegularFileNoFollow(path, label, maximumBytes) {
  let handle
  try {
    handle = await open(path, fsConstants.O_RDONLY | NO_FOLLOW)
    const metadata = await handle.stat()
    if (!metadata.isFile()) throw new Error(`${label} must be a regular file`)
    if (metadata.nlink !== 1) throw new Error(`${label} must have exactly one hard link`)
    if (!Number.isSafeInteger(metadata.size) || metadata.size < 1 || metadata.size > maximumBytes) {
      throw new Error(`${label} has an unsafe size`)
    }
    return Object.freeze({ bytes: await handle.readFile(), metadata })
  } catch (error) {
    if (error?.code === 'ELOOP') throw new Error(`${label} may not be a symbolic link`)
    throw error
  } finally {
    await handle?.close()
  }
}

async function removePnpmInstallState(root, nodeModules) {
  const path = join(root, ...PNPM_INSTALL_STATE)
  const metadata = await lstat(path).catch(error => error?.code === 'ENOENT' ? undefined : Promise.reject(error))
  if (metadata === undefined) return 0
  if (metadata.isSymbolicLink()) throw new Error('pnpm mutable install-state file may not be a symbolic link')
  const { bytes } = await readRegularFileNoFollow(path, 'pnpm mutable install-state file', MAX_PNPM_INSTALL_STATE_BYTES)
  let value
  try { value = JSON.parse(bytes.toString('utf8')) } catch {
    throw new Error('pnpm mutable install-state file is invalid')
  }
  if (value?.packageManager !== PNPM_PACKAGE_MANAGER) {
    throw new Error('pnpm mutable install-state file has an unexpected package manager')
  }
  if (value?.virtualStoreDir !== '.pnpm') {
    throw new Error('pnpm mutable install-state file has an unsafe virtual store')
  }
  const virtualStore = resolve(nodeModules, value.virtualStoreDir)
  if (virtualStore !== join(nodeModules, '.pnpm')) {
    throw new Error('pnpm mutable install-state file virtual store escapes node_modules')
  }
  const canonicalVirtualStore = await realpath(virtualStore).catch(error => {
    throw new Error('pnpm mutable install-state file virtual store is unreadable', { cause: error })
  })
  if (!isWithin(root, canonicalVirtualStore)) {
    throw new Error('pnpm mutable install-state file virtual store escapes the deployed runtime tree')
  }
  await unlink(path)
  return 1
}

function matchingRootAlias(value, rootAliases) {
  return rootAliases.find(alias => value === alias || value.startsWith(`${alias}${sep}`))
}

function runtimePathFor(root, candidate, label) {
  const identity = relative(root, candidate).split(sep).join('/')
  if (identity === '..' || identity.startsWith('../') || isAbsolute(identity) || /[\u0000\r\n':]/u.test(identity)) {
    throw new Error(`${label} cannot be represented as a safe runtime path`)
  }
  return identity === '' ? PNPM_RUNTIME_ROOT : `${PNPM_RUNTIME_ROOT}/${identity}`
}

async function normalizePnpmShimPath(value, root, rootAliases, label, options = {}) {
  if (!isAbsolute(value)) throw new Error(`${label} must be an absolute path before normalization`)
  const alias = matchingRootAlias(value, rootAliases)
  if (alias === undefined) throw new Error(`${label} escapes the deployed runtime tree`)
  const suffix = value.slice(alias.length)
  const logical = resolve(root, `.${suffix}`)
  if (!isWithin(root, logical)) throw new Error(`${label} escapes the deployed runtime tree`)
  let probe = logical
  let target
  let targetMetadata
  while (target === undefined) {
    try {
      const canonicalProbe = await realpath(probe)
      const canonicalMetadata = await lstat(canonicalProbe)
      target = canonicalProbe
      targetMetadata = canonicalMetadata
    } catch (error) {
      if (error?.code !== 'ENOENT' || options.mustExist === true || probe === root) {
        throw new Error(`${label} is dangling or unreadable`, { cause: error })
      }
      probe = dirname(probe)
      if (!isWithin(root, probe)) throw new Error(`${label} escapes the deployed runtime tree`)
    }
  }
  if (!isWithin(root, target)) throw new Error(`${label} escapes the deployed runtime tree`)
  const unresolved = relative(probe, logical)
  if (unresolved !== '' && !targetMetadata.isDirectory()) {
    throw new Error(`${label} has a non-directory existing ancestor`)
  }
  if (options.mustBeFile === true && !targetMetadata.isFile()) throw new Error(`${label} must resolve to a regular file`)
  if (options.mustBeDirectoryWhenPresent === true && unresolved === '' && !targetMetadata.isDirectory()) {
    throw new Error(`${label} must resolve to a directory when present`)
  }
  const canonicalCandidate = resolve(target, unresolved)
  if (!isWithin(root, canonicalCandidate)) throw new Error(`${label} escapes the deployed runtime tree`)
  return Object.freeze({
    logical,
    canonical: canonicalCandidate,
    normalized: runtimePathFor(root, canonicalCandidate, label),
  })
}

async function requireScanOnlyRootAliases(values, trustedAliases) {
  if (values === undefined) return Object.freeze([])
  if (!Array.isArray(values)) throw new Error('scan-only forbidden roots must be an array')
  const aliases = []
  for (const value of values) {
    if (typeof value !== 'string' || !isAbsolute(value)) {
      throw new Error('scan-only forbidden root must be an absolute path')
    }
    const logical = resolve(value)
    if (logical === sep) throw new Error('scan-only forbidden root may not be the filesystem root')
    const metadata = await lstat(logical)
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error('scan-only forbidden root must be a real directory')
    }
    aliases.push(logical, await realpath(logical))
  }
  return Object.freeze([...new Set(aliases)]
    .filter(alias => !trustedAliases.includes(alias))
    .sort((left, right) => right.length - left.length))
}

function isPathSegmentByte(value) {
  return (value >= 0x30 && value <= 0x39)
    || (value >= 0x41 && value <= 0x5a)
    || (value >= 0x61 && value <= 0x7a)
    || value === 0x2d
    || value === 0x2e
    || value === 0x5f
    || value === 0x7e
    || value >= 0x80
}

function hasLeadingPathSegment(bytes, offset) {
  let cursor = offset - 1
  if (cursor < 0) return false
  if (bytes[cursor] === 0x2f || bytes[cursor] === 0x5c) {
    while (cursor >= 0 && (bytes[cursor] === 0x2f || bytes[cursor] === 0x5c)) cursor -= 1
    return cursor >= 0 && isPathSegmentByte(bytes[cursor])
  }
  return isPathSegmentByte(bytes[cursor])
}

function isAbsolutePathTokenByte(value) {
  return isPathSegmentByte(value)
    || value === 0x2f
    || value === 0x5c
    || value === 0x3a
    || value === 0x25
}

function embeddedAbsolutePathResolvesToAlias(bytes, offset, afterOffset, alias) {
  let start = offset
  while (start > 0 && isAbsolutePathTokenByte(bytes[start - 1])) start -= 1
  const prefix = bytes.subarray(start, afterOffset).toString('utf8')
  if (prefix.startsWith('/')) return posix.normalize(prefix) === alias
  if (!/^file:\/\//iu.test(prefix)) return false
  try {
    return posix.normalize(fileURLToPath(prefix)) === alias
  } catch {
    return true
  }
}

export function containsAbsoluteRootAlias(bytes, rootAliases) {
  return rootAliases.some(alias => {
    const token = Buffer.from(alias, 'utf8')
    let offset = bytes.indexOf(token)
    while (offset !== -1) {
      const afterOffset = offset + token.byteLength
      const after = afterOffset === bytes.byteLength ? undefined : bytes[afterOffset]
      const embeddedInLeadingPathSegment = hasLeadingPathSegment(bytes, offset)
      const hasTrailingPathSegment = after !== undefined && isPathSegmentByte(after)
      if (!hasTrailingPathSegment
        && (!embeddedInLeadingPathSegment
          || embeddedAbsolutePathResolvesToAlias(bytes, offset, afterOffset, alias))) return true
      offset = bytes.indexOf(token, offset + token.byteLength)
    }
    return false
  })
}

function runtimeIdentity(root, path, label) {
  const identity = relative(root, path).split(sep).join('/')
  if (identity === '' || identity === '..' || identity.startsWith('../') || isAbsolute(identity)) {
    throw new Error(`${label} identity escapes the deployed runtime tree`)
  }
  return identity
}

async function writeAtomicRegularFile(path, bytes, mode) {
  normalizationSequence += 1
  const temporary = join(dirname(path), `.${basename(path)}.paimind-normalize-${process.pid}-${normalizationSequence}`)
  let handle
  try {
    handle = await open(temporary, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | NO_FOLLOW, mode)
    await handle.writeFile(bytes)
    await handle.chmod(mode)
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporary, path)
  } finally {
    await handle?.close()
    await unlink(temporary).catch(error => {
      if (error?.code !== 'ENOENT') throw error
    })
  }
}

async function normalizePnpmCommandShim(path, metadata, root, rootAliases) {
  const { bytes, metadata: openedMetadata } = await readRegularFileNoFollow(
    path,
    'pnpm command shim',
    MAX_PNPM_COMMAND_SHIM_BYTES,
  )
  if (!containsAbsoluteRootAlias(bytes, rootAliases)) return Object.freeze({ changed: false, bytes })
  if ((openedMetadata.mode & 0o111) === 0 || (metadata.mode & 0o111) === 0) {
    throw new Error('pnpm command shim must be executable')
  }
  if (bytes.includes(0)) throw new Error('pnpm command shim contains binary data')
  const source = bytes.toString('utf8')
  if (!source.startsWith('#!/bin/sh\n')
    || !source.includes('basedir=$(dirname ')
    || !source.includes('if [ -z "$NODE_PATH" ]; then')) {
    throw new Error('pnpm command shim has an unexpected format')
  }
  const lines = source.split('\n')
  const nodePathVariants = []
  let normalizedTarget
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const nodePath = line.match(/^  export NODE_PATH="([^"]+)"$/u)
    if (nodePath !== null) {
      const base = []
      let inherited = false
      for (const component of nodePath[1].split(delimiter)) {
        if (component === '$NODE_PATH') {
          if (inherited) throw new Error('pnpm command shim NODE_PATH contains duplicate inheritance')
          inherited = true
          continue
        }
        if (inherited) throw new Error('pnpm command shim NODE_PATH inheritance must be last')
        const normalized = await normalizePnpmShimPath(
          component,
          root,
          rootAliases,
          'pnpm command shim NODE_PATH entry',
          { mustBeDirectoryWhenPresent: true },
        )
        base.push(normalized.normalized)
      }
      if (base.length < 1) throw new Error('pnpm command shim NODE_PATH is empty')
      nodePathVariants.push(Object.freeze({ base: Object.freeze(base), inherited }))
      continue
    }
    const target = line.match(/^# cmd-shim-target=(.+)$/u)
    if (target !== null) {
      if (normalizedTarget !== undefined) throw new Error('pnpm command shim contains duplicate targets')
      normalizedTarget = await normalizePnpmShimPath(
        target[1],
        root,
        rootAliases,
        'pnpm command shim target',
        { mustExist: true, mustBeFile: true },
      )
      continue
    }
    if (rootAliases.some(alias => line.includes(alias))) {
      throw new Error('pnpm command shim contains a mutable deploy root outside trusted fields')
    }
  }
  if (nodePathVariants.length !== 2 || normalizedTarget === undefined) {
    throw new Error('pnpm command shim is missing trusted path fields')
  }
  const withoutInheritance = nodePathVariants.find(value => value.inherited === false)
  const withInheritance = nodePathVariants.find(value => value.inherited === true)
  if (withoutInheritance === undefined || withInheritance === undefined
    || JSON.stringify(withoutInheritance.base) !== JSON.stringify(withInheritance.base)) {
    throw new Error('pnpm command shim NODE_PATH variants are inconsistent')
  }
  const fixedNodePath = withoutInheritance.base.join(delimiter)
  const normalized = Buffer.from(`#!/bin/sh
set -eu
if [ -z "\${NODE_PATH:-}" ]; then
  export NODE_PATH='${fixedNodePath}'
else
  export NODE_PATH='${fixedNodePath}':"$NODE_PATH"
fi
exec node '${normalizedTarget.normalized}' "$@"
# paimind-normalized-pnpm-shim=v1
# cmd-shim-target=${normalizedTarget.normalized}
`, 'utf8')
  if (containsAbsoluteRootAlias(normalized, rootAliases)) throw new Error('pnpm command shim retains the mutable deploy root')
  await writeAtomicRegularFile(path, normalized, openedMetadata.mode & 0o777)
  return Object.freeze({ changed: true, bytes: normalized })
}

async function removeLegacyDeploySelfLink(root) {
  const parent = join(root, ...LEGACY_DEPLOY_SELF_LINK.slice(0, -1))
  const parentMetadata = await lstat(parent).catch(error => error?.code === 'ENOENT' ? undefined : Promise.reject(error))
  if (parentMetadata === undefined) return 0
  if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink()) {
    throw new Error('legacy deploy self-link parent must be a real runtime directory')
  }
  const canonicalParent = await realpath(parent)
  if (!isWithin(root, canonicalParent)) throw new Error('legacy deploy self-link parent escapes the runtime tree')
  const path = join(canonicalParent, LEGACY_DEPLOY_SELF_LINK.at(-1))
  const metadata = await lstat(path).catch(error => error?.code === 'ENOENT' ? undefined : Promise.reject(error))
  if (metadata === undefined) return 0
  if (!metadata.isSymbolicLink()) throw new Error('legacy deploy self-link path must not contain a file or directory')
  await unlink(path)
  return 1
}

export async function pruneNodePtyNativeBuildState(root, platform = process.platform) {
  const canonicalRoot = await realpath(root)
  const buildRoot = join(canonicalRoot, ...NODE_PTY_BUILD_ROOT)
  const metadata = await lstat(buildRoot).catch(error => error?.code === 'ENOENT' ? undefined : Promise.reject(error))
  if (metadata === undefined) return 0
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(buildRoot) !== buildRoot) {
    throw new Error('node-pty native build root must be one real runtime directory')
  }
  const releaseRoot = join(buildRoot, 'Release')
  const releaseMetadata = await lstat(releaseRoot)
  if (!releaseMetadata.isDirectory() || releaseMetadata.isSymbolicLink() || await realpath(releaseRoot) !== releaseRoot) {
    throw new Error('node-pty Release root must be one real runtime directory')
  }
  const nativePath = join(releaseRoot, 'pty.node')
  const nativeMetadata = await lstat(nativePath)
  if (!nativeMetadata.isFile() || nativeMetadata.isSymbolicLink() || nativeMetadata.nlink !== 1) {
    throw new Error('node-pty native runtime binary must be one private regular file')
  }
  if (platform === 'darwin') {
    const spawnHelperPath = join(releaseRoot, 'spawn-helper')
    const spawnHelperMetadata = await lstat(spawnHelperPath)
      .catch(error => error?.code === 'ENOENT' ? undefined : Promise.reject(error))
    if (spawnHelperMetadata === undefined || !spawnHelperMetadata.isFile() || spawnHelperMetadata.isSymbolicLink()
      || spawnHelperMetadata.nlink !== 1 || (spawnHelperMetadata.mode & 0o111) === 0) {
      throw new Error('node-pty spawn helper must be one private executable regular file on Darwin')
    }
  }
  let removed = 0
  for (const entry of await readdir(buildRoot, { withFileTypes: true })) {
    if (entry.name === 'Release') continue
    await rm(join(buildRoot, entry.name), { recursive: entry.isDirectory(), force: false })
    removed += 1
  }
  for (const entry of await readdir(releaseRoot, { withFileTypes: true })) {
    if (entry.name === 'pty.node' || (platform === 'darwin' && entry.name === 'spawn-helper')) continue
    await rm(join(releaseRoot, entry.name), { recursive: entry.isDirectory(), force: false })
    removed += 1
  }
  return removed
}

export async function normalizeWorkerRuntimeTree(rootInput, options = {}) {
  if (typeof rootInput !== 'string' || !isAbsolute(rootInput)) throw new Error('runtime root must be absolute')
  const logicalRoot = resolve(rootInput)
  const rootMetadata = await lstat(logicalRoot)
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) throw new Error('runtime root must be a real directory')
  const root = await realpath(logicalRoot)
  const nodeModules = join(root, 'node_modules')
  const nodeModulesMetadata = await lstat(nodeModules)
  if (!nodeModulesMetadata.isDirectory() || nodeModulesMetadata.isSymbolicLink()) {
    throw new Error('runtime node_modules must be a real directory')
  }
  const rootAliases = [...new Set([logicalRoot, root])].sort((left, right) => right.length - left.length)
  const scanOnlyRootAliases = await requireScanOnlyRootAliases(options.scanOnlyRootAliases, rootAliases)
  const forbiddenRootAliases = Object.freeze([...new Set([...rootAliases, ...scanOnlyRootAliases])]
    .sort((left, right) => right.length - left.length))
  const removedPnpmInstallStateFiles = await removePnpmInstallState(root, nodeModules)
  const removedLegacyDeploySelfLinks = await removeLegacyDeploySelfLink(root)
  // Traverse the complete deploy root once. Every mutation is checked from the
  // bytes that will remain in the normalized tree, so a second full-tree pass
  // would only repeat the same I/O. Raw symlink targets are checked before
  // resolution to retain the former residual-scan guarantee.
  const pending = [root]
  const visitedDirectories = new Set()
  const visitedFiles = new Set()
  let removedGeneratedArtifacts = await pruneNodePtyNativeBuildState(root)
  let inspectedSymlinks = 0
  let normalizedPnpmCommandShims = 0
  let inspectedRegularFiles = 0
  while (pending.length > 0) {
    const logical = pending.pop()
    const metadata = await lstat(logical)
    let target = logical
    if (metadata.isSymbolicLink()) {
      const rawTarget = await readlink(logical, { encoding: 'buffer' })
      if (containsAbsoluteRootAlias(rawTarget, forbiddenRootAliases)) {
        throw new Error(`runtime symlink retains the mutable deploy root: ${runtimeIdentity(root, logical, 'runtime symlink')}`)
      }
      target = await containedTarget(root, logical)
      inspectedSymlinks += 1
    }
    const targetMetadata = await lstat(target)
    if (targetMetadata.isDirectory()) {
      if (visitedDirectories.has(target)) continue
      visitedDirectories.add(target)
      const names = []
      const directory = await opendir(target)
      for await (const entry of directory) names.push(entry.name)
      names.sort().reverse()
      for (const name of names) pending.push(join(target, name))
    } else if (targetMetadata.isFile()) {
      if (visitedFiles.has(target)) continue
      visitedFiles.add(target)
      if (basename(logical) === '.modules.yaml' || basename(target) === '.modules.yaml') {
        throw new Error('pnpm mutable install-state file must be absent from the normalized runtime tree')
      }
      if (GENERATED_ARTIFACT.test(basename(target))) {
        await unlink(target)
        removedGeneratedArtifacts += 1
        continue
      }
      inspectedRegularFiles += 1
      let bytes
      if (!metadata.isSymbolicLink() && basename(dirname(logical)) === '.bin') {
        bytes = await readFile(target)
        if (bytes.subarray(0, 10).equals(Buffer.from('#!/bin/sh\n', 'utf8'))) {
          const normalized = await normalizePnpmCommandShim(logical, metadata, root, rootAliases)
          bytes = normalized.bytes
          if (normalized.changed) normalizedPnpmCommandShims += 1
        }
      } else {
        bytes = await readFile(target)
      }
      if (containsAbsoluteRootAlias(bytes, forbiddenRootAliases)) {
        throw new Error(`runtime regular file retains the mutable deploy root: ${runtimeIdentity(root, logical, 'runtime file')}`)
      }
    } else {
      throw new Error(`unsupported runtime file type: ${basename(logical)}`)
    }
  }
  return Object.freeze({
    status: 'PASS',
    removedGeneratedArtifacts,
    removedPnpmInstallStateFiles,
    removedLegacyDeploySelfLinks,
    normalizedPnpmCommandShims,
    residualDeployRootHits: 0,
    residualScanRegularFiles: inspectedRegularFiles,
    residualScanSymlinks: inspectedSymlinks,
    scanOnlyForbiddenRoots: scanOnlyRootAliases.length,
    inspectedRegularFiles,
    inspectedSymlinks,
  })
}

const modulePath = await realpath(fileURLToPath(import.meta.url))
const invoked = process.argv[1] !== undefined
  && await realpath(resolve(process.argv[1])).catch(() => undefined) === modulePath
if (invoked) {
  try {
    const scanOnlyRootAliases = process.argv.slice(3).map(value => {
      if (!value.startsWith('--forbid-root=') || value.length <= '--forbid-root='.length) {
        throw new Error('Worker runtime normalizer received an unknown argument')
      }
      return value.slice('--forbid-root='.length)
    })
    const result = await normalizeWorkerRuntimeTree(process.argv[2] ?? '/runtime', { scanOnlyRootAliases })
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } catch (error) {
    process.stderr.write(`Worker runtime tree normalization failed: ${error instanceof Error ? error.message : 'unknown error'}\n`)
    process.exitCode = 1
  }
}
