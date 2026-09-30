import assert from 'node:assert/strict'
import test from 'node:test'
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { projectBundleRuntimeDependencies } from '../../deploy/enterprise/worker/runtime/verify-worker-deployment.mjs'

async function fixture(t, dependencies = { '@paimind/feature': '1.0.0' }) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'paimind-module-projection-')))
  t.after(() => rm(root, { recursive: true }))
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@paimind/enterprise-worker-runtime', private: true }))
  const modules = join(root, 'node_modules')
  const bundleModules = join(modules, '.pnpm/bundle/node_modules')
  const bundle = join(bundleModules, '@paimind/harness-bundle')
  const feature = join(modules, '.pnpm/feature/node_modules/@paimind/feature')
  await mkdir(bundle, { recursive: true }); await mkdir(feature, { recursive: true })
  await mkdir(join(modules, '@paimind'))
  await writeFile(join(bundle, 'package.json'), JSON.stringify({ name: '@paimind/harness-bundle', dependencies }))
  await writeFile(join(feature, 'package.json'), JSON.stringify({ name: '@paimind/feature', version: '1.0.0' }))
  const bundleLink = join(modules, '@paimind/harness-bundle')
  await symlink(relative(dirname(bundleLink), bundle), bundleLink)
  const dependency = join(bundleModules, '@paimind/feature')
  await symlink(relative(dirname(dependency), feature), dependency)
  return { root, modules, bundleModules, feature, destination: join(modules, '@paimind/feature') }
}

test('projects only existing bundle dependencies into native module resolution and is idempotent', async t => {
  const f = await fixture(t)
  const original = await readFile(join(f.feature, 'package.json'), 'utf8')
  const first = await projectBundleRuntimeDependencies(f.root)
  assert.equal(first.createdLinks, 1)
  assert.deepEqual(first.dependencies.map(item => item.name), ['@paimind/feature'])
  assert.ok((await lstat(f.destination)).isSymbolicLink())
  assert.equal(await realpath(f.destination), f.feature)
  assert.equal(await readFile(join(f.feature, 'package.json'), 'utf8'), original)
  assert.equal((await projectBundleRuntimeDependencies(f.root)).createdLinks, 0)
})

test('rejects a conflicting top-level plugin instead of overwriting another projection', async t => {
  const f = await fixture(t)
  await mkdir(f.destination)
  await writeFile(join(f.destination, 'owner.txt'), 'preserve')
  await assert.rejects(projectBundleRuntimeDependencies(f.root), /Conflicting runtime module projection/)
  assert.equal(await readFile(join(f.destination, 'owner.txt'), 'utf8'), 'preserve')
})

test('preflights every dependency before creating any module link', async t => {
  const f = await fixture(t, { '@paimind/feature': '1.0.0', '@paimind/missing': '1.0.0' })
  await assert.rejects(projectBundleRuntimeDependencies(f.root), { code: 'ENOENT' })
  await assert.rejects(lstat(f.destination), { code: 'ENOENT' })
})

test('rejects escaped dependency links and control-plane package leakage', async t => {
  const f = await fixture(t, { '@paimind/feature': '1.0.0', 'outside': '1.0.0' })
  await symlink('/usr', join(f.bundleModules, 'outside'))
  await assert.rejects(projectBundleRuntimeDependencies(f.root), /escapes/)
  await assert.rejects(lstat(f.destination), { code: 'ENOENT' })
  const blocked = await fixture(t, { postgres: '3.4.9' })
  await assert.rejects(projectBundleRuntimeDependencies(blocked.root), /Forbidden bundle runtime dependency/)
})
