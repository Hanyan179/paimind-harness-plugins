import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'

function option(name) {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

const runtimeOption = option('--runtime')
const dshBinOption = option('--dsh-bin')
const upstreamOption = option('--upstream-checkout')
const expectedDshVersion = option('--expected-dsh-version')

if (runtimeOption === undefined || dshBinOption === undefined) {
  console.error('usage: node scripts/verify-agent-skill-centers.mjs --runtime <root> --dsh-bin <bin.js> [--expected-dsh-version <version>] [--upstream-checkout <checkout>]')
  process.exit(2)
}

const repositoryRoot = resolve('.')
const runtimeRoot = resolve(runtimeOption)
const dshBin = resolve(dshBinOption)
const upstreamRoot = upstreamOption === undefined ? undefined : resolve(upstreamOption)
const agentMarketRoot = resolve(repositoryRoot, 'packages/agent-market')
const agentBuilderRoot = resolve(repositoryRoot, 'packages/agent-builder')
const skillMarketRoot = resolve(repositoryRoot, 'packages/skill-market')
const dshHome = await mkdtemp(resolve(tmpdir(), 'paimind-centers-dsh-home-'))
const env = { ...process.env, DSH_HOME: dshHome }

async function makeBundle(name, rows) {
  const root = resolve(dshHome, name)
  await mkdir(root, { recursive: true })
  await writeFile(resolve(root, 'package.json'), JSON.stringify({
    name: `@paimind/test-${name}`,
    version: '0.0.0',
    private: true,
    type: 'module',
    files: ['cordis.patch.yml'],
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    dependencies: {},
  }, null, 2))
  await writeFile(resolve(root, 'cordis.patch.yml'), `- insert:\n${rows.map(row => `    - id: ${row.id}\n      name: '${row.name}'`).join('\n')}\n`)
  return root
}

function run(command, args, label) {
  console.log(`start: ${label}`)
  const result = spawnSync(command, args, {
    cwd: runtimeRoot,
    env,
    encoding: 'utf8',
    timeout: 120_000,
  })
  if (result.status !== 0) {
    throw new Error(`${label} failed (${String(result.status)})\n${result.stdout}\n${result.stderr}`)
  }
  console.log(`passed: ${label}`)
  return `${result.stdout}\n${result.stderr}`
}

function dsh(args, label) {
  return run(process.execPath, [dshBin, ...args], label)
}

function gitStatus() {
  if (upstreamRoot === undefined) return null
  const result = spawnSync('git', ['status', '--porcelain=v1'], {
    cwd: upstreamRoot,
    encoding: 'utf8',
    timeout: 30_000,
  })
  if (result.status !== 0) throw new Error(`read Harness git status failed\n${result.stdout}\n${result.stderr}`)
  return result.stdout.trim()
}

async function freePort() {
  const server = createServer()
  await new Promise((resolveReady, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveReady)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('failed to reserve a TCP port')
  await new Promise((resolveClosed, reject) => server.close(error => error === undefined ? resolveClosed() : reject(error)))
  return address.port
}

async function stopProcess(child) {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([
    new Promise(resolveExit => child.once('exit', resolveExit)),
    new Promise(resolveTimeout => setTimeout(resolveTimeout, 5_000)),
  ])
  if (child.exitCode === null) child.kill('SIGKILL')
}

async function bootAndProbe(expectedPackages, absentPackages, label) {
  console.log(`start: ${label}`)
  const port = await freePort()
  const child = spawn(process.execPath, [
    dshBin, '--profile', 'web', '--host', '127.0.0.1', '--port', String(port),
  ], { cwd: runtimeRoot, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { output += chunk })
  try {
    await new Promise((resolveReady, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Harness boot timed out\n${output}`)), 30_000)
      const inspect = () => {
        if (!output.includes('dsh web:')) return
        clearTimeout(timeout)
        resolveReady()
      }
      child.stdout.on('data', inspect)
      child.once('exit', code => {
        clearTimeout(timeout)
        reject(new Error(`Harness exited before readiness (${String(code)})\n${output}`))
      })
    })
    const response = await fetch(`http://127.0.0.1:${port}/`)
    const html = await response.text()
    if (!response.ok) throw new Error(`Harness readiness probe returned HTTP ${response.status}`)
    for (const packageName of expectedPackages) {
      if (!html.includes(packageName)) throw new Error(`Harness manifest is missing ${packageName}`)
    }
    for (const packageName of absentPackages) {
      if (html.includes(packageName)) throw new Error(`Harness manifest unexpectedly contains ${packageName}`)
    }
    console.log(`passed: ${label}`)
  } finally {
    await stopProcess(child)
  }
}

const beforeStatus = gitStatus()
try {
  const bothBundleRoot = await makeBundle('agent-skill-centers', [
    { id: 'paimind-skill-market', name: '@paimind/skill-market' },
    { id: 'paimind-agent-builder', name: '@paimind/agent-builder' },
    { id: 'paimind-agent-market', name: '@paimind/agent-market' },
  ])
  const skillBundleRoot = await makeBundle('skill-center-only', [
    { id: 'paimind-skill-market', name: '@paimind/skill-market' },
  ])
  const agentBundleRoot = await makeBundle('agent-center-only', [
    { id: 'paimind-agent-builder', name: '@paimind/agent-builder' },
    { id: 'paimind-agent-market', name: '@paimind/agent-market' },
  ])
  const version = dsh(['--version'], 'read Harness runtime version').trim()
  if (expectedDshVersion !== undefined && version !== expectedDshVersion) {
    throw new Error(`Harness runtime version mismatch: expected ${expectedDshVersion}, received ${version}`)
  }
  dsh(['--profile', 'web', '--dump-config'], 'initialize disposable Web profile')
  dsh([
    'plugin', '--profile', 'web', 'add',
    bothBundleRoot,
    skillMarketRoot,
    agentBuilderRoot,
    agentMarketRoot,
  ], 'install Agent Center and Skill Center')
  await bootAndProbe(
    ['@paimind/agent-market', '@paimind/skill-market'],
    [],
    'boot with both product centers',
  )

  dsh([
    'plugin', '--profile', 'web', 'remove',
    '@paimind/test-agent-skill-centers',
    '@paimind/agent-market',
    '@paimind/agent-builder',
    '@paimind/skill-market',
  ], 'remove both product centers')
  dsh(['plugin', '--profile', 'web', 'add', skillBundleRoot, skillMarketRoot], 'install only Skill Center')
  await bootAndProbe(
    ['@paimind/skill-market'],
    ['@paimind/agent-market'],
    'boot with only Skill Center',
  )

  dsh([
    'plugin', '--profile', 'web', 'remove',
    '@paimind/test-skill-center-only',
    '@paimind/skill-market',
  ], 'remove Skill Center')
  dsh([
    'plugin', '--profile', 'web', 'add',
    agentBundleRoot,
    agentBuilderRoot,
    agentMarketRoot,
  ], 'install only Agent Center')
  await bootAndProbe(
    ['@paimind/agent-market'],
    ['@paimind/skill-market'],
    'boot with only Agent Center',
  )

  dsh([
    'plugin', '--profile', 'web', 'remove',
    '@paimind/test-agent-center-only',
    '@paimind/agent-market',
    '@paimind/agent-builder',
  ], 'remove remaining product-center packages')
  const restored = dsh(['--profile', 'web', '--dump-config'], 'confirm native profile restoration')
  if (restored.includes('@paimind/agent-market')
    || restored.includes('@paimind/agent-builder')
    || restored.includes('@paimind/skill-market')) {
    throw new Error(`a product-center package remained after removal\n${restored}`)
  }
  await bootAndProbe(
    [],
    ['@paimind/agent-market', '@paimind/skill-market'],
    'boot native Harness after both centers are removed',
  )
  if (gitStatus() !== beforeStatus) throw new Error('DeepSeek Harness worktree changed during product-center composition')
  console.log(`Agent/Skill Center composition passed: Harness ${version}, both installed, each independently absent, native restore, zero upstream delta`)
} finally {
  await rm(dshHome, { recursive: true, force: true })
}
