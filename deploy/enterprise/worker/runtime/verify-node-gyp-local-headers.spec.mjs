import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, chmod, link, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { verifyNodeGypLocalHeaders } from './verify-node-gyp-local-headers.mjs'

const script = fileURLToPath(new URL('./verify-node-gyp-local-headers.mjs', import.meta.url))
const expectedUid = process.getuid?.() ?? 0
const expectedGid = process.getgid?.() ?? 0

function versionHeader(version = process.versions.node, abi = process.versions.modules) {
  const [major, minor, patch] = version.split('.')
  return `#define NODE_MAJOR_VERSION ${major}\n#define NODE_MINOR_VERSION ${minor}\n#define NODE_PATCH_VERSION ${patch}\n#define NODE_MODULE_VERSION ${abi}\n`
}

async function createFixture() {
  const temporary = await mkdtemp(join(tmpdir(), 'paimind-node-gyp-headers-'))
  const root = await realpath(temporary)
  const include = join(root, 'include')
  const node = join(include, 'node')
  await mkdir(node, { recursive: true })
  await Promise.all([
    writeFile(join(node, 'common.gypi'), '{"variables":{}}\n'),
    writeFile(join(node, 'config.gypi'), '{"variables":{"node_prefix":"/usr/local"}}\n'),
    writeFile(join(node, 'node.h'), '#pragma once\n'),
    writeFile(join(node, 'node_version.h'), versionHeader()),
  ])
  await Promise.all([
    chmod(root, 0o755),
    chmod(include, 0o755),
    chmod(node, 0o755),
    chmod(join(node, 'common.gypi'), 0o644),
    chmod(join(node, 'config.gypi'), 0o644),
    chmod(join(node, 'node.h'), 0o644),
    chmod(join(node, 'node_version.h'), 0o644),
  ])
  return Object.freeze({ temporary, root, node })
}

function options(overrides = {}) {
  return {
    expectedNodeVersion: process.versions.node,
    expectedPlatform: process.platform,
    expectedArch: process.arch,
    expectedNodeAbi: process.versions.modules,
    expectedUid,
    expectedGid,
    ...overrides,
  }
}

test('verifies one canonical owner-controlled Node header tree and emits path-free digests', async t => {
  const fixture = await createFixture()
  t.after(async () => { await rm(fixture.temporary, { recursive: true }) })
  const receipt = await verifyNodeGypLocalHeaders(fixture.root, options())
  assert.equal(receipt.status, 'PASS')
  assert.equal(receipt.nodeVersion, process.versions.node)
  assert.equal(receipt.platform, process.platform)
  assert.equal(receipt.architecture, process.arch)
  assert.equal(receipt.nodeAbi, process.versions.modules)
  assert.match(receipt.headerRootDigest, /^sha256:[a-f0-9]{64}$/u)
  assert.deepEqual(receipt.headerTree, {
    fileCount: 4,
    directoryCount: 1,
    totalBytes: 194,
    contentDigest: receipt.headerTree.contentDigest,
    metadataDigest: receipt.headerTree.metadataDigest,
  })
  assert.match(receipt.headerTree.contentDigest, /^sha256:[a-f0-9]{64}$/u)
  assert.match(receipt.headerTree.metadataDigest, /^sha256:[a-f0-9]{64}$/u)
  assert.deepEqual(receipt.headers.map(entry => entry.relativePath), [
    'include/node/common.gypi',
    'include/node/config.gypi',
    'include/node/node.h',
    'include/node/node_version.h',
  ])
  for (const entry of receipt.headers) {
    assert.equal(entry.mode, '0644')
    assert.equal(entry.uid, expectedUid)
    assert.equal(entry.gid, expectedGid)
    assert.match(entry.digest, /^sha256:[a-f0-9]{64}$/u)
  }
  assert.equal(JSON.stringify(receipt).includes(fixture.root), false)
})

test('scans the complete header tree and fails closed on nested writable or symbolic-link entries', async t => {
  await t.test('nested regular file contributes to the full-tree receipt', async () => {
    const fixture = await createFixture()
    try {
      const nested = join(fixture.node, 'cppgc')
      await mkdir(nested)
      await writeFile(join(nested, 'api.h'), '#pragma once\n')
      await chmod(nested, 0o755)
      await chmod(join(nested, 'api.h'), 0o644)
      const receipt = await verifyNodeGypLocalHeaders(fixture.root, options())
      assert.equal(receipt.headerTree.fileCount, 5)
      assert.equal(receipt.headerTree.directoryCount, 2)
      assert.equal(receipt.headerTree.totalBytes, 207)
    } finally { await rm(fixture.temporary, { recursive: true }) }
  })
  await t.test('nested writable file is rejected', async () => {
    const fixture = await createFixture()
    try {
      await writeFile(join(fixture.node, 'writable.h'), '#pragma once\n')
      await chmod(join(fixture.node, 'writable.h'), 0o664)
      await assert.rejects(verifyNodeGypLocalHeaders(fixture.root, options()), /owner-controlled regular file/u)
    } finally { await rm(fixture.temporary, { recursive: true }) }
  })
  await t.test('nested symbolic link is rejected', async () => {
    const fixture = await createFixture()
    try {
      await symlink('node.h', join(fixture.node, 'alias.h'))
      await assert.rejects(verifyNodeGypLocalHeaders(fixture.root, options()), /owner-controlled regular file|symbolic link/u)
    } finally { await rm(fixture.temporary, { recursive: true }) }
  })
})

test('fails closed on version, mode, symlink and hardlink drift', async t => {
  await t.test('version drift', async () => {
    const fixture = await createFixture()
    try {
      await writeFile(join(fixture.node, 'node_version.h'), versionHeader('1.2.3'))
      await assert.rejects(verifyNodeGypLocalHeaders(fixture.root, options()), /version header does not match/u)
    } finally { await rm(fixture.temporary, { recursive: true }) }
  })
  await t.test('module ABI drift', async () => {
    const fixture = await createFixture()
    try {
      await writeFile(join(fixture.node, 'node_version.h'), versionHeader(process.versions.node, '999'))
      await assert.rejects(verifyNodeGypLocalHeaders(fixture.root, options()), /module ABI/u)
    } finally { await rm(fixture.temporary, { recursive: true }) }
  })
  await t.test('writable header', async () => {
    const fixture = await createFixture()
    try {
      await chmod(join(fixture.node, 'node.h'), 0o664)
      await assert.rejects(verifyNodeGypLocalHeaders(fixture.root, options()), /owner-controlled regular file/u)
    } finally { await rm(fixture.temporary, { recursive: true }) }
  })
  await t.test('symbolic link header', async () => {
    const fixture = await createFixture()
    try {
      const target = join(fixture.node, 'node-target.h')
      await writeFile(target, '#pragma once\n')
      await chmod(target, 0o644)
      await rename(join(fixture.node, 'node.h'), join(fixture.node, 'node-original.h'))
      await symlink('node-target.h', join(fixture.node, 'node.h'))
      await assert.rejects(verifyNodeGypLocalHeaders(fixture.root, options()), /owner-controlled regular file|symbolic link/u)
    } finally { await rm(fixture.temporary, { recursive: true }) }
  })
  await t.test('hard linked header', async () => {
    const fixture = await createFixture()
    try {
      const original = join(fixture.node, 'node-original.h')
      await rename(join(fixture.node, 'node.h'), original)
      await link(original, join(fixture.node, 'node.h'))
      await assert.rejects(verifyNodeGypLocalHeaders(fixture.root, options()), /owner-controlled regular file/u)
    } finally { await rm(fixture.temporary, { recursive: true }) }
  })
})

test('rejects a non-canonical header root and active runtime identity drift', async t => {
  const fixture = await createFixture()
  const parent = resolve(fixture.root, '..')
  const alias = join(parent, `paimind-node-gyp-headers-alias-${process.pid}`)
  t.after(async () => {
    await rm(alias).catch(() => {})
    await rm(fixture.temporary, { recursive: true })
  })
  await symlink(fixture.root, alias)
  await assert.rejects(verifyNodeGypLocalHeaders(alias, options()), /canonical/u)
  await assert.rejects(
    verifyNodeGypLocalHeaders(fixture.root, options({ expectedNodeVersion: '1.2.3' })),
    /Active Node runtime/u,
  )
  await assert.rejects(
    verifyNodeGypLocalHeaders(fixture.root, options({ expectedUid: expectedUid + 1 })),
    /owner-controlled/u,
  )
})

test('CLI returns one strict receipt with a minimal environment and rejects incomplete identities', async t => {
  const fixture = await createFixture()
  t.after(async () => { await rm(fixture.temporary, { recursive: true }) })
  const result = spawnSync(process.execPath, [
    script,
    fixture.root,
    process.versions.node,
    process.platform,
    process.arch,
    process.versions.modules,
    String(expectedUid),
    String(expectedGid),
  ], {
    cwd: fixture.root,
    env: { PATH: '/usr/bin:/bin' },
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, '')
  assert.equal(JSON.parse(result.stdout).status, 'PASS')
  const invalid = spawnSync(process.execPath, [script, fixture.root], {
    cwd: fixture.root,
    env: { PATH: '/usr/bin:/bin' },
    encoding: 'utf8',
  })
  assert.equal(invalid.status, 1)
  assert.match(invalid.stderr, /requires root, version, platform, architecture, ABI, uid and gid/u)
})

