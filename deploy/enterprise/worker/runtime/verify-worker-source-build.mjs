import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WORKER_BUILD_ROOT_CONTRACT } from './worker-build-root-contract.mjs'

const digest = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`
export function sourceBuildArtifacts(manifest) {
  const files = new Set()
  const collect = value => {
    if (typeof value === 'string' && /\.(?:js|d\.ts)$/.test(value)) files.add(value.replace(/^\.\//, ''))
    else if (value && typeof value === 'object') for (const child of Object.values(value)) collect(child)
  }
  collect(manifest.exports)
  for (const source of manifest.paimindBuild?.node ?? []) {
    if (!/^src\/[\w./-]+\.tsx?$/.test(source) || source.split('/').includes('..')) throw new Error('Invalid Node build entry')
    files.add(`lib/${source.slice(4).replace(/\.tsx?$/, '.js')}`)
  }
  if (manifest.paimindBuild?.client) files.add('lib/client.js')
  for (const path of [...files]) {
    if (isAbsolute(path) || path.split('/').includes('..') || !path.startsWith('lib/')) throw new Error('Build artifact escapes its package lib root')
    files.add(`${path}.map`)
  }
  if (manifest.paimindBuild && files.size === 0) throw new Error('Build package has no artifacts')
  return [...files].sort()
}

export async function verifyWorkerSourceBuild(root) {
  const artifacts = []
  const packages = []
  async function capture(packageRoot, path, packageName) {
    const absolute = join(packageRoot, path)
    const metadata = await lstat(absolute)
    assert.ok(metadata.isFile() && !metadata.isSymbolicLink() && metadata.nlink === 1 && metadata.size > 0)
    assert.equal(await realpath(absolute), absolute)
    const bytes = await readFile(absolute)
    assert.equal(bytes.length, metadata.size)
    artifacts.push({ packageName, path: relative(root, absolute), bytes: bytes.length, digest: digest(bytes) })
  }
  for (const directory of (await readdir(join(root, 'packages'))).sort()) {
    const packageRoot = join(root, 'packages', directory)
    const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
    const files = sourceBuildArtifacts(manifest)
    if (files.length === 0) continue
    packages.push(manifest.name)
    for (const path of files) await capture(packageRoot, path, manifest.name)
  }
  assert.ok(packages.includes('@paimind/enterprise-admin') && packages.includes('@paimind/harness-compat'))
  for (const path of ['lib/cli.js', 'lib/cli.js.map']) {
    await capture(join(root, 'apps/enterprise-server'), path, '@paimind/enterprise-server')
  }
  assert.ok(artifacts.length > packages.length)
  return { schemaVersion: 1, status: 'SOURCE_BUILD_VERIFIED', platform: `${process.platform}/${process.arch}`,
    nodeVersion: process.versions.node, packages, artifacts, artifactDigest: digest(JSON.stringify(artifacts)),
    lockfileDigest: digest(await readFile(join(root, 'pnpm-lock.yaml'))),
    finalWorkerImageAccepted: false, runtimeAssemblyVerified: false }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 2)
  assert.equal(await realpath(process.cwd()), WORKER_BUILD_ROOT_CONTRACT.roots.source.path)
  assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'arm64')
  process.stdout.write(`${JSON.stringify(await verifyWorkerSourceBuild(process.cwd()))}\n`)
}
