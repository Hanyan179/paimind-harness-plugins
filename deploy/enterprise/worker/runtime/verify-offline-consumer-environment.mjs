import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { constants } from 'node:fs'
import { lstat, open, readFile, readdir, realpath } from 'node:fs/promises'
import { networkInterfaces } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPnpmEffectivePolicySurface } from './verify-pnpm-effective-policy.mjs'
import { WORKER_BUILD_ROOT_CONTRACT } from './worker-build-root-contract.mjs'

const roots = WORKER_BUILD_ROOT_CONTRACT.roots
const digest = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`
export const INSTALL_ARGS = Object.freeze([
  `--store-dir=${roots.store.path}`, '--frozen-store', '--config.side-effects-cache=false',
])
export const DEPLOY_ARGS = Object.freeze([
  // Native Harness expresses runtime services as required peers. Resolve them
  // through the pinned manager's normal peer graph, using only the sealed
  // offline store, instead of copying a legacy hand-maintained package list.
  ...INSTALL_ARGS, '--config.inject-workspace-packages=true', '--config.auto-install-peers=true',
  '--offline', '--filter', '@paimind/enterprise-worker-runtime', '--fail-if-no-match',
  'deploy', '--prod', '--legacy', roots.deploy.path,
])

export function requireReadOnlyExactMount(text, target, writeAccess) {
  const mounts = text.split('\n').filter(Boolean).map(line => line.split(' '))
  const matches = mounts.filter(fields => fields[4] === target)
  if (matches.length !== 1 || mounts.some(fields => fields[4]?.startsWith(`${target}/`))) {
    throw new Error('Expected one exact consumer mount without nested mounts')
  }
  // The current build executor reports rw in mountinfo while write-open
  // actually returns EROFS. Metadata alone is not authority: require the real
  // OS read-only-filesystem denial, never mere EACCES/EPERM or mode bits.
  if (writeAccess?.writable !== false || writeAccess.denial !== 'EROFS') {
    throw new Error('Consumer write-open must be denied by the read-only filesystem')
  }
  return { mountTableReadOnly: matches[0][5].split(',').includes('ro'), writeOpenDenial: 'EROFS' }
}

export function requireLoopbackOnlyNetwork(interfaces) {
  const entries = Object.entries(interfaces)
  if (entries.length !== 1 || entries[0][0] !== 'lo' || !Array.isArray(entries[0][1])
    || entries[0][1].length === 0 || entries[0][1].some(address => address.internal !== true
      || !['127.0.0.1', '::1'].includes(address.address))) throw new Error('Consumer external network must be absent')
  return true
}

export async function verifyOfflineConsumerEnvironment(phase = 'install') {
  assert.ok(phase === 'install' || phase === 'deploy')
  assert.equal(process.platform, 'linux')
  assert.equal(process.arch, 'arm64')
  assert.equal(process.versions.node, '24.19.0')
  assert.equal(process.versions.modules, '137')
  assert.equal(await realpath(process.cwd()), roots.source.path)
  for (const [key, value] of Object.entries({
    HOME: `/tmp/paimind-source-${phase}-home`, TMPDIR: `/tmp/paimind-source-${phase}-tmp`,
    COREPACK_ENABLE_NETWORK: '0', CI: 'true', pnpm_config_minimum_release_age: '0',
    pnpm_config_cache_dir: `${roots.store.path}/.cache/pnpm`,
    npm_config_nodedir: '/usr/local', npm_config_devdir: `/tmp/paimind-source-${phase}-node-gyp`,
  })) assert.equal(process.env[key], value, `Unexpected consumer environment: ${key}`)
  for (const path of [process.env.HOME, process.env.TMPDIR, process.env.npm_config_devdir]) {
    const stat = await lstat(path)
    assert.equal(await realpath(path), path)
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === 0 && stat.gid === 0 && (stat.mode & 0o7777) === 0o700)
  }
  assert.deepEqual(await readdir(process.env.npm_config_devdir), [])
  for (const path of ['/root/.cache/node-gyp', `${process.env.HOME}/.cache/node-gyp`]) {
    assert.equal(await lstat(path).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error }), false)
  }
  const mountInfo = await readFile('/proc/self/mountinfo', 'utf8')
  // Opening an existing file without O_TRUNC does not alter its bytes. Keep
  // exact OS denial codes to distinguish read-only filesystems from mode bits.
  const writeAccess = []
  for (const path of [`${roots.store.path}/v11/index.db`, '/usr/local/include/node/node.h']) {
    let handle
    try {
      handle = await open(path, constants.O_WRONLY | constants.O_NOFOLLOW)
      writeAccess.push({ path, writable: true })
    } catch (error) {
      writeAccess.push({ path, writable: false, denial: ['EROFS', 'EACCES', 'EPERM'].includes(error.code) ? error.code : 'UNEXPECTED' })
    } finally { await handle?.close() }
  }
  const storeMount = requireReadOnlyExactMount(mountInfo, roots.store.path, writeAccess[0])
  const headersMount = requireReadOnlyExactMount(mountInfo, '/usr/local/include/node', writeAccess[1])
  const externalNetworkDisabled = requireLoopbackOnlyNetwork(networkInterfaces())
  let configuration
  const policy = readPnpmEffectivePolicySurface((...args) => {
    const result = spawnSync(...args)
    if (result.status === 0) configuration = JSON.parse(result.stdout)
    return result
  }, roots.source.path, process.env, [], 0)
  assert.equal(configuration.cacheDir, process.env.pnpm_config_cache_dir)
  // pnpm 11.7 config rejects install-only --store-dir/--frozen-store options.
  // Read its actual environment policy here; the installer imports these
  // exact arguments instead of pretending config list parsed those options.
  return { schemaVersion: 1, status: 'PASS', phase, platform: 'linux/arm64', policy,
    installArguments: phase === 'install' ? INSTALL_ARGS : DEPLOY_ARGS,
    storeReadOnly: true, headersReadOnly: true, storeMount, headersMount, externalNetworkDisabled, nodeGypCacheEmpty: true,
    lockfileDigest: digest(await readFile('pnpm-lock.yaml')),
    workspacePolicyDigest: digest(await readFile('pnpm-workspace.yaml')) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const phase = process.argv.length === 2 ? 'install' : process.argv.length === 3 && process.argv[2] === '--deploy' ? 'deploy' : undefined
  if (phase === undefined) throw new Error('Consumer verifier accepts only an optional --deploy')
  process.stdout.write(`${JSON.stringify(await verifyOfflineConsumerEnvironment(phase))}\n`)
}
