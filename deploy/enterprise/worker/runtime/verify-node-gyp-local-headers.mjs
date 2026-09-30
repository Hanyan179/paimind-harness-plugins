#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { lstat, open, readdir, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const NO_FOLLOW = fsConstants.O_NOFOLLOW ?? 0
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+$/u
const ABI = /^(?:0|[1-9][0-9]{0,5})$/u
const PLATFORM = /^[a-z0-9][a-z0-9._-]{0,31}$/u
const ARCH = /^[a-z0-9][a-z0-9._-]{0,31}$/u
const HEADER_FILES = Object.freeze([
  Object.freeze({ relativePath: 'include/node/common.gypi', maximumBytes: 2 * 1024 * 1024 }),
  Object.freeze({ relativePath: 'include/node/config.gypi', maximumBytes: 8 * 1024 * 1024 }),
  Object.freeze({ relativePath: 'include/node/node.h', maximumBytes: 4 * 1024 * 1024 }),
  Object.freeze({ relativePath: 'include/node/node_version.h', maximumBytes: 1024 * 1024 }),
])
const MAXIMUM_TREE_FILES = 2_048
const MAXIMUM_TREE_DIRECTORIES = 512
const MAXIMUM_TREE_BYTES = 128 * 1024 * 1024
const MAXIMUM_TREE_FILE_BYTES = 16 * 1024 * 1024

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function mode(metadata) {
  return (metadata.mode & 0o7777).toString(8).padStart(4, '0')
}

function requireIdentity(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`)
  return value
}

function requireContained(root, path, label) {
  const candidate = resolve(root, path)
  const relation = relative(root, candidate)
  if (relation === '' || relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new Error(`${label} escapes the pinned Node header root`)
  }
  return candidate
}

function requireDirectory(metadata, label, expectedUid, expectedGid) {
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== expectedUid
    || metadata.gid !== expectedGid || mode(metadata) !== '0755') {
    throw new Error(`${label} is not a pinned owner-controlled 0755 directory`)
  }
}

async function readHeader(root, canonicalRoot, descriptor, expectedUid, expectedGid) {
  const absolute = requireContained(root, descriptor.relativePath, 'Node header')
  const lexical = await lstat(absolute)
  if (!lexical.isFile() || lexical.isSymbolicLink() || lexical.nlink !== 1
    || lexical.uid !== expectedUid || lexical.gid !== expectedGid || mode(lexical) !== '0644'
    || lexical.size < 1 || lexical.size > descriptor.maximumBytes) {
    throw new Error(`Node header ${descriptor.relativePath} is not one bounded owner-controlled regular file`)
  }
  let handle
  try {
    handle = await open(absolute, fsConstants.O_RDONLY | NO_FOLLOW)
    const metadata = await handle.stat()
    if (!metadata.isFile() || metadata.dev !== lexical.dev || metadata.ino !== lexical.ino
      || metadata.nlink !== 1 || metadata.uid !== expectedUid || metadata.gid !== expectedGid
      || mode(metadata) !== '0644' || metadata.size !== lexical.size) {
      throw new Error(`Node header ${descriptor.relativePath} changed during verification`)
    }
    const canonical = await realpath(absolute)
    if (canonical !== resolve(canonicalRoot, descriptor.relativePath)) {
      throw new Error(`Node header ${descriptor.relativePath} does not resolve inside the pinned root`)
    }
    const bytes = await handle.readFile()
    if (bytes.byteLength !== metadata.size) throw new Error(`Node header ${descriptor.relativePath} changed while reading`)
    return Object.freeze({
      relativePath: descriptor.relativePath,
      bytes: bytes.byteLength,
      digest: sha256(bytes),
      mode: mode(metadata),
      uid: metadata.uid,
      gid: metadata.gid,
      contents: bytes,
    })
  } catch (error) {
    if (error?.code === 'ELOOP') throw new Error(`Node header ${descriptor.relativePath} may not be a symbolic link`)
    throw error
  } finally {
    await handle?.close()
  }
}

async function scanHeaderTree(root, canonicalRoot, expectedUid, expectedGid) {
  const files = []
  const directories = []
  let totalBytes = 0

  const visit = async relativeDirectory => {
    if (directories.length >= MAXIMUM_TREE_DIRECTORIES) throw new Error('Node header tree has too many directories')
    const absoluteDirectory = requireContained(root, relativeDirectory, 'Node header tree directory')
    const lexicalDirectory = await lstat(absoluteDirectory)
    requireDirectory(lexicalDirectory, `Node header tree directory ${relativeDirectory}`, expectedUid, expectedGid)
    if (await realpath(absoluteDirectory) !== resolve(canonicalRoot, relativeDirectory)) {
      throw new Error(`Node header tree directory ${relativeDirectory} does not resolve inside the pinned root`)
    }
    directories.push(Object.freeze({
      relativePath: relativeDirectory,
      mode: mode(lexicalDirectory),
      uid: lexicalDirectory.uid,
      gid: lexicalDirectory.gid,
    }))

    const entries = await readdir(absoluteDirectory)
    entries.sort()
    for (const name of entries) {
      if (typeof name !== 'string' || name === '' || name === '.' || name === '..' || name.includes('/') || name.includes('\0')) {
        throw new Error('Node header tree contains an invalid directory entry')
      }
      const relativePath = `${relativeDirectory}/${name}`
      const absolute = requireContained(root, relativePath, 'Node header tree entry')
      const lexical = await lstat(absolute)
      if (lexical.isDirectory() && !lexical.isSymbolicLink()) {
        await visit(relativePath)
        continue
      }
      if (!lexical.isFile() || lexical.isSymbolicLink() || lexical.nlink !== 1
        || lexical.uid !== expectedUid || lexical.gid !== expectedGid || mode(lexical) !== '0644'
        || lexical.size < 1 || lexical.size > MAXIMUM_TREE_FILE_BYTES) {
        throw new Error(`Node header tree entry ${relativePath} is not one bounded owner-controlled regular file`)
      }
      if (files.length >= MAXIMUM_TREE_FILES) throw new Error('Node header tree has too many files')
      totalBytes += lexical.size
      if (totalBytes > MAXIMUM_TREE_BYTES) throw new Error('Node header tree exceeds the maximum byte budget')
      let handle
      try {
        handle = await open(absolute, fsConstants.O_RDONLY | NO_FOLLOW)
        const metadata = await handle.stat()
        if (!metadata.isFile() || metadata.dev !== lexical.dev || metadata.ino !== lexical.ino
          || metadata.nlink !== 1 || metadata.uid !== expectedUid || metadata.gid !== expectedGid
          || mode(metadata) !== '0644' || metadata.size !== lexical.size) {
          throw new Error(`Node header tree entry ${relativePath} changed during verification`)
        }
        if (await realpath(absolute) !== resolve(canonicalRoot, relativePath)) {
          throw new Error(`Node header tree entry ${relativePath} does not resolve inside the pinned root`)
        }
        const bytes = await handle.readFile()
        if (bytes.byteLength !== metadata.size) throw new Error(`Node header tree entry ${relativePath} changed while reading`)
        files.push(Object.freeze({
          relativePath,
          bytes: bytes.byteLength,
          digest: sha256(bytes),
          mode: mode(metadata),
          uid: metadata.uid,
          gid: metadata.gid,
        }))
      } catch (error) {
        if (error?.code === 'ELOOP') throw new Error(`Node header tree entry ${relativePath} may not be a symbolic link`)
        throw error
      } finally {
        await handle?.close()
      }
    }
  }

  await visit('include/node')
  const contentIdentity = files.map(({ relativePath, bytes, digest }) => ({ relativePath, bytes, digest }))
  const metadataIdentity = [
    ...directories.map(entry => ({ type: 'directory', ...entry })),
    ...files.map(({ relativePath, bytes, mode: fileMode, uid, gid }) => ({
      type: 'file', relativePath, bytes, mode: fileMode, uid, gid,
    })),
  ]
  return Object.freeze({
    fileCount: files.length,
    directoryCount: directories.length,
    totalBytes,
    contentDigest: sha256(Buffer.from(JSON.stringify(contentIdentity), 'utf8')),
    metadataDigest: sha256(Buffer.from(JSON.stringify(metadataIdentity), 'utf8')),
    files: Object.freeze(files),
  })
}

function requireHeaderVersion(bytes, expectedVersion, expectedNodeAbi) {
  const source = bytes.toString('utf8')
  const names = ['MAJOR', 'MINOR', 'PATCH']
  const parts = names.map(name => {
    const matches = [...source.matchAll(new RegExp(`^#define NODE_${name}_VERSION ([0-9]+)$`, 'gmu'))]
    if (matches.length !== 1) throw new Error(`Node version header has an invalid ${name.toLowerCase()} definition`)
    return matches[0][1]
  })
  const actual = parts.join('.')
  if (actual !== expectedVersion) throw new Error('Node version header does not match the pinned runtime version')
  const abiMatches = [...source.matchAll(/^#define NODE_MODULE_VERSION ([0-9]+)$/gmu)]
  if (abiMatches.length !== 1 || abiMatches[0][1] !== expectedNodeAbi) {
    throw new Error('Node version header does not match the pinned module ABI')
  }
}

export async function verifyNodeGypLocalHeaders(root, options = {}) {
  const expectedNodeVersion = options.expectedNodeVersion
  const expectedPlatform = options.expectedPlatform
  const expectedArch = options.expectedArch
  const expectedNodeAbi = options.expectedNodeAbi
  const expectedUid = requireIdentity(options.expectedUid, 'expected Node header uid')
  const expectedGid = requireIdentity(options.expectedGid, 'expected Node header gid')
  if (typeof root !== 'string' || root.includes('\0') || !isAbsolute(root) || resolve(root) !== root) {
    throw new Error('Node header root must be one normalized absolute path')
  }
  if (typeof expectedNodeVersion !== 'string' || !VERSION.test(expectedNodeVersion)
    || typeof expectedPlatform !== 'string' || !PLATFORM.test(expectedPlatform)
    || typeof expectedArch !== 'string' || !ARCH.test(expectedArch)
    || typeof expectedNodeAbi !== 'string' || !ABI.test(expectedNodeAbi)) {
    throw new Error('Pinned Node runtime identity is invalid')
  }
  if (process.versions.node !== expectedNodeVersion
    || process.platform !== expectedPlatform || process.arch !== expectedArch
    || process.versions.modules !== expectedNodeAbi) {
    throw new Error('Active Node runtime does not match the pinned header identity')
  }
  const canonicalRoot = await realpath(root)
  if (canonicalRoot !== root) throw new Error('Node header root must be canonical and may not be a symbolic link')
  requireDirectory(await lstat(root), 'Node header root', expectedUid, expectedGid)
  for (const directory of ['include', 'include/node']) {
    const absolute = requireContained(root, directory, 'Node header directory')
    if (await realpath(absolute) !== absolute) throw new Error('Node header directory must be canonical')
    requireDirectory(await lstat(absolute), `Node header directory ${directory}`, expectedUid, expectedGid)
  }
  const headers = []
  for (const descriptor of HEADER_FILES) {
    headers.push(await readHeader(root, canonicalRoot, descriptor, expectedUid, expectedGid))
  }
  const versionHeader = headers.find(entry => entry.relativePath === 'include/node/node_version.h')
  requireHeaderVersion(versionHeader.contents, expectedNodeVersion, expectedNodeAbi)
  const tree = await scanHeaderTree(root, canonicalRoot, expectedUid, expectedGid)
  for (const descriptor of HEADER_FILES) {
    const treeEntry = tree.files.find(entry => entry.relativePath === descriptor.relativePath)
    const coreEntry = headers.find(entry => entry.relativePath === descriptor.relativePath)
    if (treeEntry === undefined || treeEntry.digest !== coreEntry.digest || treeEntry.bytes !== coreEntry.bytes) {
      throw new Error(`Node header ${descriptor.relativePath} changed between core and full-tree verification`)
    }
  }
  return Object.freeze({
    schemaVersion: 1,
    status: 'PASS',
    nodeVersion: expectedNodeVersion,
    platform: expectedPlatform,
    architecture: expectedArch,
    nodeAbi: expectedNodeAbi,
    headerRootDigest: sha256(Buffer.from(canonicalRoot, 'utf8')),
    headerTree: Object.freeze({
      fileCount: tree.fileCount,
      directoryCount: tree.directoryCount,
      totalBytes: tree.totalBytes,
      contentDigest: tree.contentDigest,
      metadataDigest: tree.metadataDigest,
    }),
    headers: Object.freeze(headers.map(({ contents: _contents, ...entry }) => Object.freeze(entry))),
  })
}

function parseIdentity(value, label) {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]{0,9})$/u.test(value)) {
    throw new Error(`${label} is invalid`)
  }
  return requireIdentity(Number(value), label)
}

const modulePath = await realpath(fileURLToPath(import.meta.url))
const invoked = process.argv[1] !== undefined
  && await realpath(resolve(process.argv[1])).catch(() => undefined) === modulePath
if (invoked) {
  try {
    if (process.argv.length !== 9) throw new Error('Node header verifier requires root, version, platform, architecture, ABI, uid and gid')
    const receipt = await verifyNodeGypLocalHeaders(process.argv[2], {
      expectedNodeVersion: process.argv[3],
      expectedPlatform: process.argv[4],
      expectedArch: process.argv[5],
      expectedNodeAbi: process.argv[6],
      expectedUid: parseIdentity(process.argv[7], 'expected Node header uid'),
      expectedGid: parseIdentity(process.argv[8], 'expected Node header gid'),
    })
    process.stdout.write(`${JSON.stringify(receipt)}\n`)
  } catch (error) {
    process.stderr.write(`Node-gyp local header verification failed: ${error instanceof Error ? error.message : 'unknown error'}\n`)
    process.exitCode = 1
  }
}

