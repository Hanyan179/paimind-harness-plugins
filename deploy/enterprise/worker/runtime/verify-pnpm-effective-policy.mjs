#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import {
  lstat, mkdir, mkdtemp, open, readFile, realpath, rm, writeFile,
} from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  WORKER_BUILD_ROOT_CONTRACT,
  WORKER_BUILD_ROOT_CONTRACT_DIGEST,
} from './worker-build-root-contract.mjs'

const NO_FOLLOW = fsConstants.O_NOFOLLOW ?? 0
const PNPM_VERSION = '11.7.0'
const PNPM_EXECUTABLE = '/pnpm/pnpm'
const COREPACK_HOME = '/opt/paimind-enterprise-corepack-home'
const PNPM_PACKAGE_ROOT = `${COREPACK_HOME}/v1/pnpm/${PNPM_VERSION}`
const PNPM_MANIFEST = `${PNPM_PACKAGE_ROOT}/package.json`
const PNPM_BUNDLE = `${PNPM_PACKAGE_ROOT}/dist/pnpm.mjs`
const SOURCE_ROOT = WORKER_BUILD_ROOT_CONTRACT.roots.source.path
const STORE_ROOT = WORKER_BUILD_ROOT_CONTRACT.roots.store.path
const FIXED_PATH = '/pnpm:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
const DIGEST = /^sha256:[a-f0-9]{64}$/u
const MAX_CONFIG_BYTES = 256 * 1024
const MAX_BUNDLE_BYTES = 32 * 1024 * 1024
const MAX_INSTALLER_OUTPUT_BYTES = 1024 * 1024
const INSTALLER_TIMEOUT_MS = 60_000
const POLICY_FIELDS = Object.freeze([
  'minimumReleaseAge',
  'minimumReleaseAgeStrict',
  'minimumReleaseAgeExclude',
  'minimumReleaseAgeIgnoreMissingTime',
  'trustPolicy',
  'trustPolicyExclude',
  'trustPolicyIgnoreAfter',
  'trustLockfile',
])
const POLICY_SURFACE_KEYS = Object.freeze([
  'minimumReleaseAgeType',
  ...POLICY_FIELDS,
])
const SCENARIO_NAMES = Object.freeze([
  'producer-workspace-number-1440',
  'consumer-cli-string-zero',
  'consumer-environment-number-zero',
  'consumer-workspace-number-zero',
])
const RECEIPT_KEYS = Object.freeze([
  'schemaVersion', 'status', 'packageManager', 'evidenceRole', 'platform', 'proof',
  'networkPolicy', 'rootContractDigest', 'bundleDigest', 'verifierFunctionDigest',
  'workspacePolicyDigest', 'lockfileDigest', 'fixtureDigest', 'installerCommandDigest',
  'policyFields', 'sourceInputsUnchanged', 'rawConfigPersisted', 'scenarios',
  'consumerDecision', 'sourcePolicies',
])
const SCENARIO_KEYS = Object.freeze([
  'name', 'configurationSource', 'policySurface', 'installerOutcome', 'exitCode',
  'errorCodes', 'registryRequests', 'registryRequestDigest', 'cacheFresh',
  'lockfileUnchanged', 'userStoreDependency', 'rawOutputPersisted', 'diagnosticDigest',
])
const INSTALLER_ARGUMENTS = Object.freeze([
  'install',
  '--lockfile-only',
  '--offline',
  '--frozen-lockfile',
  '--ignore-scripts',
  '--reporter=ndjson',
  '--frozen-store',
  '--config.side-effects-cache=false',
])
const SENTINEL_PACKAGE = 'paimind-policy-sentinel'
const SENTINEL_VERSION = '1.0.0'
const SENTINEL_INTEGRITY = `sha512-${Buffer.alloc(64).toString('base64')}`

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

const EMPTY_REQUEST_DIGEST = sha256(Buffer.alloc(0))

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function canonicalDigest(value) {
  return sha256(Buffer.from(canonicalJson(value), 'utf8'))
}

function hasExactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0')
}

function requirePlatform(value) {
  if (!hasExactKeys(value, ['os', 'architecture'])
    || value.os !== 'linux' || value.architecture !== 'arm64') {
    throw new Error('pnpm effective policy platform is not locked to linux/arm64')
  }
  return Object.freeze({ ...value })
}

export function isTrustedRootReadOnlyMetadata(metadata) {
  return metadata !== null && typeof metadata === 'object'
    && metadata.uid === 0 && metadata.gid === 0
    && Number.isSafeInteger(metadata.mode) && (metadata.mode & 0o222) === 0
}

function requirePolicySurface(value, expectedAge) {
  if (!hasExactKeys(value, POLICY_SURFACE_KEYS)
    || value.minimumReleaseAgeType !== typeof expectedAge
    || value.minimumReleaseAge !== expectedAge
    || !(value.minimumReleaseAgeStrict === null || value.minimumReleaseAgeStrict === true)
    || !Array.isArray(value.minimumReleaseAgeExclude) || value.minimumReleaseAgeExclude.length !== 0
    || !(value.minimumReleaseAgeIgnoreMissingTime === null || value.minimumReleaseAgeIgnoreMissingTime === false)
    || value.trustPolicy !== null
    || !Array.isArray(value.trustPolicyExclude) || value.trustPolicyExclude.length !== 0
    || value.trustPolicyIgnoreAfter !== null
    || !(value.trustLockfile === null || value.trustLockfile === false)) {
    throw new Error('pnpm effective policy surface is invalid or unsafe')
  }
  return Object.freeze({
    ...value,
    minimumReleaseAgeExclude: Object.freeze([...value.minimumReleaseAgeExclude]),
    trustPolicyExclude: Object.freeze([...value.trustPolicyExclude]),
  })
}

function requireScenario(value, expectedName) {
  const producer = expectedName === 'producer-workspace-number-1440'
  const cli = expectedName === 'consumer-cli-string-zero'
  const expectedAge = producer ? 1_440 : (cli ? '0' : 0)
  const expectedSource = producer || expectedName === 'consumer-workspace-number-zero'
    ? 'workspace-number'
    : (cli ? 'cli-string' : 'environment-number')
  const errorCodesValid = producer
    ? (Array.isArray(value?.errorCodes) && value.errorCodes.length === 1
      && ['ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION', 'ERR_PNPM_LOCKFILE_RESOLUTION_VERIFICATION']
        .includes(value.errorCodes[0]))
    : Array.isArray(value?.errorCodes) && value.errorCodes.length === 0
  if (!hasExactKeys(value, SCENARIO_KEYS)
    || value.name !== expectedName || value.configurationSource !== expectedSource
    || value.installerOutcome !== (producer ? 'policy-rejected' : 'pass')
    || !Number.isSafeInteger(value.exitCode)
    || (producer ? value.exitCode <= 0 : value.exitCode !== 0)
    || !errorCodesValid
    || !Number.isSafeInteger(value.registryRequests) || value.registryRequests < 0
    || ((producer || cli) ? value.registryRequests < 1 : value.registryRequests !== 0)
    || !DIGEST.test(value.registryRequestDigest)
    || ((!producer && !cli) && value.registryRequestDigest !== EMPTY_REQUEST_DIGEST)
    || value.cacheFresh !== true || value.lockfileUnchanged !== true
    || value.userStoreDependency !== false || value.rawOutputPersisted !== false
    || !DIGEST.test(value.diagnosticDigest)
    || value.diagnosticDigest !== scenarioDiagnosticDigest(value)) {
    throw new Error('pnpm effective policy installer scenario is invalid')
  }
  return Object.freeze({
    ...value,
    policySurface: requirePolicySurface(value.policySurface, expectedAge),
    errorCodes: Object.freeze([...value.errorCodes]),
  })
}

export function requirePnpmEffectivePolicyReceipt(value) {
  if (!hasExactKeys(value, RECEIPT_KEYS)
    || value.schemaVersion !== 3 || value.status !== 'PASS'
    || value.packageManager !== `pnpm@${PNPM_VERSION}`
    || value.evidenceRole !== 'authoritative-linux-arm64-pnpm-installer-plumbing'
    || value.proof !== 'real-install-config-normalization-resolver-lockfile-verification'
    || value.networkPolicy !== 'buildkit-network-none-loopback-registry-sentinel-only'
    || value.rootContractDigest !== WORKER_BUILD_ROOT_CONTRACT_DIGEST
    || !DIGEST.test(value.bundleDigest) || !DIGEST.test(value.verifierFunctionDigest)
    || !DIGEST.test(value.workspacePolicyDigest) || !DIGEST.test(value.lockfileDigest)
    || !DIGEST.test(value.fixtureDigest) || !DIGEST.test(value.installerCommandDigest)
    || value.fixtureDigest !== canonicalDigest({
      packageManager: `pnpm@${PNPM_VERSION}`,
      package: SENTINEL_PACKAGE,
      version: SENTINEL_VERSION,
      integrity: SENTINEL_INTEGRITY,
      publishedAgeMinutes: 60,
      lockfileVersion: '9.0',
    })
    || value.installerCommandDigest !== canonicalDigest(INSTALLER_ARGUMENTS)
    || JSON.stringify(value.policyFields) !== JSON.stringify(POLICY_FIELDS)
    || value.sourceInputsUnchanged !== true || value.rawConfigPersisted !== false
    || !Array.isArray(value.scenarios) || value.scenarios.length !== SCENARIO_NAMES.length
    || value.consumerDecision !== 'numeric-zero-disables-lockfile-age-network-path-string-zero-does-not') {
    throw new Error('pnpm effective policy receipt is invalid')
  }
  const platform = requirePlatform(value.platform)
  if (!hasExactKeys(value.sourcePolicies, ['producer', 'consumer'])) {
    throw new Error('pnpm effective policy receipt lacks direct source policy readback')
  }
  const sourcePolicies = Object.freeze({
    producer: requirePolicySurface(value.sourcePolicies.producer, 1_440),
    consumer: requirePolicySurface(value.sourcePolicies.consumer, 0),
  })
  const scenarios = value.scenarios.map((scenario, index) => requireScenario(scenario, SCENARIO_NAMES[index]))
  const [producer, cli, environment, workspace] = scenarios
  if (canonicalJson(sourcePolicies.producer) !== canonicalJson(producer.policySurface)
    || canonicalJson(sourcePolicies.consumer) !== canonicalJson(environment.policySurface)
    || producer.registryRequests !== cli.registryRequests
    || producer.registryRequestDigest !== cli.registryRequestDigest
    || environment.registryRequestDigest !== workspace.registryRequestDigest
    || JSON.stringify(producer.policySurface.minimumReleaseAgeExclude)
      !== JSON.stringify(environment.policySurface.minimumReleaseAgeExclude)
    || JSON.stringify(producer.policySurface.trustPolicyExclude)
      !== JSON.stringify(environment.policySurface.trustPolicyExclude)) {
    throw new Error('pnpm effective policy scenarios do not prove one stable installer policy path')
  }
  return Object.freeze({
    ...value,
    platform,
    sourcePolicies,
    policyFields: Object.freeze([...value.policyFields]),
    scenarios: Object.freeze(scenarios),
  })
}

async function readBoundedRegular(path, maximumBytes, options = {}) {
  const lexical = await lstat(path)
  if (!lexical.isFile() || lexical.isSymbolicLink() || lexical.nlink !== 1
    || lexical.size < 1 || lexical.size > maximumBytes
    || (options.requireRootReadOnly === true && !isTrustedRootReadOnlyMetadata(lexical))) {
    throw new Error('pnpm effective policy input is not one bounded trusted regular file')
  }
  let handle
  try {
    handle = await open(path, fsConstants.O_RDONLY | NO_FOLLOW)
    const metadata = await handle.stat()
    if (!metadata.isFile() || metadata.dev !== lexical.dev || metadata.ino !== lexical.ino
      || metadata.nlink !== 1 || metadata.size !== lexical.size
      || (options.requireRootReadOnly === true && !isTrustedRootReadOnlyMetadata(metadata))) {
      throw new Error('pnpm effective policy input changed during verification')
    }
    const bytes = await handle.readFile()
    if (bytes.byteLength !== metadata.size) throw new Error('pnpm effective policy input changed while reading')
    return bytes
  } finally {
    await handle?.close()
  }
}

export function extractBundledResolutionVerifier(bundleSource) {
  if (typeof bundleSource !== 'string' || bundleSource.length < 100) {
    throw new Error('pnpm bundled verifier source is invalid')
  }
  const startMarker = 'function createNpmResolutionVerifier(opts3) {'
  const endMarker = 'async function runAgeCheck('
  const start = bundleSource.indexOf(startMarker)
  const end = bundleSource.indexOf(endMarker, start + startMarker.length)
  if (start < 0 || end < 0 || bundleSource.indexOf(startMarker, start + 1) >= 0
    || bundleSource.indexOf(endMarker, end + 1) >= 0) {
    throw new Error('pnpm bundled verifier markers are not unique')
  }
  const source = bundleSource.slice(start, end).trim()
  if (source.length < 1_000 || source.length > 64_000
    || !source.includes('const ageCheckActive = Boolean(opts3.minimumReleaseAge);')
    || !source.includes('minimumReleaseAgeExclude')
    || !source.includes('trustPolicyExclude')
    || !source.includes('trustPolicyIgnoreAfter')) {
    throw new Error('pnpm bundled verifier does not match the pinned policy surface')
  }
  return Object.freeze({ source, digest: sha256(Buffer.from(source, 'utf8')) })
}

function minimalEnvironment(home, extra = {}) {
  return Object.freeze({
    PATH: FIXED_PATH,
    HOME: home,
    TMPDIR: home,
    CI: 'true',
    NO_COLOR: '1',
    COREPACK_HOME,
    COREPACK_ENABLE_NETWORK: '0',
    ...extra,
  })
}

function normalizeOptionalArray(value, label) {
  if (value === undefined || value === null) return Object.freeze([])
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) {
    throw new Error(`${label} is not an optional string list`)
  }
  return Object.freeze([...value])
}

function normalizeRawPolicy(raw, expectedAge) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)
    || raw.minimumReleaseAge !== expectedAge) {
    throw new Error('pnpm config readback does not match the expected minimum release age')
  }
  const surface = {
    minimumReleaseAgeType: typeof raw.minimumReleaseAge,
    minimumReleaseAge: raw.minimumReleaseAge,
    minimumReleaseAgeStrict: raw.minimumReleaseAgeStrict ?? null,
    minimumReleaseAgeExclude: normalizeOptionalArray(raw.minimumReleaseAgeExclude, 'minimumReleaseAgeExclude'),
    minimumReleaseAgeIgnoreMissingTime: raw.minimumReleaseAgeIgnoreMissingTime ?? null,
    trustPolicy: raw.trustPolicy ?? null,
    trustPolicyExclude: normalizeOptionalArray(raw.trustPolicyExclude, 'trustPolicyExclude'),
    trustPolicyIgnoreAfter: raw.trustPolicyIgnoreAfter ?? null,
    trustLockfile: raw.trustLockfile ?? null,
  }
  return requirePolicySurface(surface, expectedAge)
}

function readConfig(commandRunner, cwd, environment, args, expectedAge) {
  const result = commandRunner(PNPM_EXECUTABLE, [...args, 'config', 'list', '--json'], {
    cwd,
    env: environment,
    encoding: 'utf8',
    maxBuffer: MAX_CONFIG_BYTES,
    timeout: 30_000,
  })
  if (result.status !== 0 || result.signal !== null || result.error !== undefined
    || typeof result.stdout !== 'string' || typeof result.stderr !== 'string'
    || result.stderr.length !== 0 || Buffer.byteLength(result.stdout) > MAX_CONFIG_BYTES) {
    throw new Error('pnpm config readback failed closed')
  }
  let raw
  try { raw = JSON.parse(result.stdout) } catch { throw new Error('pnpm config readback is not valid JSON') }
  return normalizeRawPolicy(raw, expectedAge)
}

// The producer preflight and final policy probes share this exact strict
// eight-field readback; never persist the raw package-manager configuration.
export { readConfig as readPnpmEffectivePolicySurface }

function fixtureFiles(minimumReleaseAge) {
  const packageJson = `${JSON.stringify({
    name: 'paimind-pnpm-policy-fixture',
    private: true,
    packageManager: `pnpm@${PNPM_VERSION}`,
    dependencies: { [SENTINEL_PACKAGE]: SENTINEL_VERSION },
  }, null, 2)}\n`
  const workspace = `packages: []\nminimumReleaseAge: ${minimumReleaseAge}\n`
  const lockfile = `lockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\n\nimporters:\n\n  .:\n    dependencies:\n      ${SENTINEL_PACKAGE}:\n        specifier: ${SENTINEL_VERSION}\n        version: ${SENTINEL_VERSION}\n\npackages:\n\n  ${SENTINEL_PACKAGE}@${SENTINEL_VERSION}:\n    resolution: {integrity: ${SENTINEL_INTEGRITY}}\n\nsnapshots:\n\n  ${SENTINEL_PACKAGE}@${SENTINEL_VERSION}: {}\n`
  return Object.freeze({ packageJson, workspace, lockfile })
}

async function writeFixture(root, minimumReleaseAge) {
  const files = fixtureFiles(minimumReleaseAge)
  await mkdir(root, { recursive: true, mode: 0o700 })
  await Promise.all([
    writeFile(join(root, 'package.json'), files.packageJson, { mode: 0o600 }),
    writeFile(join(root, 'pnpm-workspace.yaml'), files.workspace, { mode: 0o600 }),
    writeFile(join(root, 'pnpm-lock.yaml'), files.lockfile, { mode: 0o600 }),
  ])
  return files
}

async function runBoundedInstaller(executable, args, options) {
  return await new Promise((resolveCommand, rejectCommand) => {
    let child
    try {
      child = spawn(executable, args, {
        cwd: options.cwd,
        env: options.environment,
        shell: false,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch {
      rejectCommand(new Error('pnpm installer probe failed before process creation'))
      return
    }
    const chunks = []
    let totalBytes = 0
    const collect = chunk => {
      const bytes = Buffer.from(chunk)
      totalBytes += bytes.byteLength
      if (totalBytes <= MAX_INSTALLER_OUTPUT_BYTES) chunks.push(bytes)
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      try { process.kill(-child.pid, 'SIGTERM') } catch {}
    }, INSTALLER_TIMEOUT_MS)
    child.once('error', error => {
      clearTimeout(timer)
      rejectCommand(error)
    })
    child.once('close', (code, signal) => {
      clearTimeout(timer)
      resolveCommand(Object.freeze({
        exitCode: code ?? 1,
        signal,
        timedOut,
        output: Buffer.concat(chunks).toString('utf8'),
        outputBytes: totalBytes,
      }))
    })
  })
}

async function createLoopbackRegistrySentinel() {
  const requestDigests = []
  const publishedAt = new Date(Date.now() - 60 * 60 * 1_000).toISOString()
  const server = createServer((request, response) => {
    requestDigests.push(sha256(Buffer.from(`${request.method ?? ''}\0${request.url ?? ''}`, 'utf8')))
    const address = server.address()
    const origin = `http://127.0.0.1:${address.port}`
    const metadata = JSON.stringify({
      name: SENTINEL_PACKAGE,
      'dist-tags': { latest: SENTINEL_VERSION },
      versions: {
        [SENTINEL_VERSION]: {
          name: SENTINEL_PACKAGE,
          version: SENTINEL_VERSION,
          dist: {
            integrity: SENTINEL_INTEGRITY,
            tarball: `${origin}/${SENTINEL_PACKAGE}/-/${SENTINEL_PACKAGE}-${SENTINEL_VERSION}.tgz`,
          },
        },
      },
      time: {
        created: publishedAt,
        modified: publishedAt,
        [SENTINEL_VERSION]: publishedAt,
      },
    })
    response.sendDate = false
    response.writeHead(200, {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(metadata)),
      connection: 'close',
    })
    response.end(metadata)
  })
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', rejectListen)
      resolveListen()
    })
  })
  const address = server.address()
  if (address === null || typeof address === 'string' || address.address !== '127.0.0.1') {
    server.close()
    throw new Error('pnpm policy registry sentinel did not bind loopback')
  }
  return Object.freeze({
    origin: `http://127.0.0.1:${address.port}`,
    snapshot() {
      const sorted = [...requestDigests].sort()
      return Object.freeze({
        registryRequests: sorted.length,
        registryRequestDigest: sha256(Buffer.from(sorted.join('\n'), 'utf8')),
      })
    },
    async close() {
      await new Promise((resolveClose, rejectClose) => server.close(
        error => error ? rejectClose(error) : resolveClose(),
      ))
    },
  })
}

function normalizedErrorCodes(output) {
  const codes = new Set(output.match(/ERR_PNPM_[A-Z0-9_]+/gu) ?? [])
  if (codes.has('ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION')) {
    return Object.freeze(['ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION'])
  }
  if (codes.has('ERR_PNPM_LOCKFILE_RESOLUTION_VERIFICATION')) {
    return Object.freeze(['ERR_PNPM_LOCKFILE_RESOLUTION_VERIFICATION'])
  }
  return Object.freeze([])
}

async function runRealInstallerScenario(spec) {
  const sentinel = await createLoopbackRegistrySentinel()
  try {
    const lockfileBefore = await readFile(join(spec.cwd, 'pnpm-lock.yaml'))
    const result = await runBoundedInstaller(spec.pnpmExecutable, [
      ...spec.cliPrefix,
      ...spec.installerArguments,
      `--store-dir=${spec.storeRoot}`,
    ], {
      cwd: spec.cwd,
      environment: {
        ...spec.environment,
        pnpm_config_registry: `${sentinel.origin}/`,
        npm_config_fetch_retries: '0',
        npm_config_fetch_timeout: '5000',
      },
    })
    const lockfileAfter = await readFile(join(spec.cwd, 'pnpm-lock.yaml'))
    const requests = sentinel.snapshot()
    const errorCodes = normalizedErrorCodes(result.output)
    if (result.signal !== null || result.timedOut || result.outputBytes > MAX_INSTALLER_OUTPUT_BYTES
      || (spec.expectedOutcome === 'policy-rejected'
        ? (result.exitCode === 0 || errorCodes.length !== 1)
        : (result.exitCode !== 0 || errorCodes.length !== 0))) {
      const failure = new Error('real pnpm installer policy scenario failed closed')
      const installerErrors = result.output.split('\n').flatMap(line => {
        try {
          const event = JSON.parse(line)
          if (event.level !== 'error') return []
          const error = event.err ?? event.error ?? event
          return [{ code: typeof error.code === 'string' ? error.code.slice(0, 100) : null,
            message: typeof error.message === 'string' ? error.message.slice(0, 500) : null }]
        } catch { return [] }
      }).slice(0, 3)
      failure.diagnostic = Object.freeze({ scenario: spec.name, exitCode: result.exitCode,
        timedOut: result.timedOut, signal: result.signal,
        // Only normalized error fields from the credential-free sentinel
        // fixture, not raw config, installer output, stack or HTTP headers.
        installerErrors,
        codes: [...new Set(result.output.match(/\b(?:ERR_PNPM_[A-Z0-9_]+|SQLITE_[A-Z0-9_]+|ENOENT|EACCES|EROFS)\b/gu) ?? [])],
        outputDigest: sha256(Buffer.from(result.output)), outputBytes: result.outputBytes })
      throw failure
    }
    return Object.freeze({
      installerOutcome: spec.expectedOutcome,
      exitCode: result.exitCode,
      errorCodes,
      ...requests,
      cacheFresh: true,
      lockfileUnchanged: lockfileBefore.equals(lockfileAfter),
      userStoreDependency: false,
      rawOutputPersisted: false,
    })
  } finally {
    await sentinel.close()
  }
}

function scenarioDiagnosticDigest(value) {
  return canonicalDigest({
    installerOutcome: value.installerOutcome,
    exitCode: value.exitCode,
    errorCodes: value.errorCodes,
    registryRequests: value.registryRequests,
    registryRequestDigest: value.registryRequestDigest,
    cacheFresh: value.cacheFresh,
    lockfileUnchanged: value.lockfileUnchanged,
    userStoreDependency: value.userStoreDependency,
    rawOutputPersisted: value.rawOutputPersisted,
  })
}

export async function verifyPnpmEffectivePolicy(options = {}) {
  const sourceRoot = options.sourceRoot ?? SOURCE_ROOT
  const storeRoot = options.storeRoot ?? STORE_ROOT
  const commandRunner = options.commandRunner ?? spawnSync
  const installerRunner = options.installerRunner ?? runRealInstallerScenario
  const pnpmBundlePath = options.pnpmBundlePath ?? PNPM_BUNDLE
  const pnpmManifestPath = options.pnpmManifestPath ?? PNPM_MANIFEST
  const requireTrustedMetadata = options.requireTrustedMetadata ?? true
  const expectedSourceRoot = requireTrustedMetadata ? SOURCE_ROOT : (options.expectedSourceRoot ?? sourceRoot)
  const expectedStoreRoot = requireTrustedMetadata ? STORE_ROOT : (options.expectedStoreRoot ?? storeRoot)
  const platform = options.platform ?? Object.freeze({ os: process.platform, architecture: process.arch })
  if (resolve(sourceRoot) !== resolve(expectedSourceRoot)
    || resolve(storeRoot) !== resolve(expectedStoreRoot)
    || typeof commandRunner !== 'function' || typeof installerRunner !== 'function') {
    throw new Error('pnpm effective policy roots or runners are invalid')
  }
  requirePlatform(platform)
  if (await realpath(pnpmBundlePath) !== pnpmBundlePath || await realpath(pnpmManifestPath) !== pnpmManifestPath) {
    throw new Error('pnpm effective policy bundle inputs must be canonical')
  }
  const [bundleBytes, manifestBytes, workspaceBefore, lockfileBefore] = await Promise.all([
    readBoundedRegular(pnpmBundlePath, MAX_BUNDLE_BYTES, { requireRootReadOnly: requireTrustedMetadata }),
    readBoundedRegular(pnpmManifestPath, 1024 * 1024, { requireRootReadOnly: requireTrustedMetadata }),
    readBoundedRegular(join(sourceRoot, 'pnpm-workspace.yaml'), 1024 * 1024),
    readBoundedRegular(join(sourceRoot, 'pnpm-lock.yaml'), 64 * 1024 * 1024),
  ])
  let manifest
  try { manifest = JSON.parse(manifestBytes.toString('utf8')) } catch { throw new Error('pnpm package manifest is invalid') }
  if (manifest?.name !== 'pnpm' || manifest?.version !== PNPM_VERSION) {
    throw new Error('pnpm package manifest does not match the pinned package manager')
  }
  const extracted = extractBundledResolutionVerifier(bundleBytes.toString('utf8'))
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'paimind-pnpm-policy-'))
  try {
    const sourceHome = join(temporaryRoot, 'source-policy-home')
    await mkdir(sourceHome, { mode: 0o700 })
    // The old receipt bound only source file digests while reading synthetic
    // fixture policy. Read all eight effective fields from the actual source
    // cwd with both real build environments, before executing installer probes.
    const sourcePolicies = Object.freeze({
      producer: readConfig(commandRunner, sourceRoot, minimalEnvironment(sourceHome), [], 1_440),
      consumer: readConfig(commandRunner, sourceRoot,
        minimalEnvironment(sourceHome, { pnpm_config_minimum_release_age: '0' }), [], 0),
    })
    const definitions = [
      Object.freeze({
        name: 'producer-workspace-number-1440', configurationSource: 'workspace-number',
        workspaceAge: 1_440, expectedAge: 1_440, cliPrefix: Object.freeze([]), environmentAge: undefined,
        expectedOutcome: 'policy-rejected',
      }),
      Object.freeze({
        name: 'consumer-cli-string-zero', configurationSource: 'cli-string',
        workspaceAge: 1_440, expectedAge: '0', cliPrefix: Object.freeze(['--config.minimum-release-age=0']),
        environmentAge: undefined, expectedOutcome: 'pass',
      }),
      Object.freeze({
        name: 'consumer-environment-number-zero', configurationSource: 'environment-number',
        workspaceAge: 1_440, expectedAge: 0, cliPrefix: Object.freeze([]), environmentAge: '0',
        expectedOutcome: 'pass',
      }),
      Object.freeze({
        name: 'consumer-workspace-number-zero', configurationSource: 'workspace-number',
        workspaceAge: 0, expectedAge: 0, cliPrefix: Object.freeze([]), environmentAge: undefined,
        expectedOutcome: 'pass',
      }),
    ]
    const scenarios = []
    for (const definition of definitions) {
      const root = join(temporaryRoot, definition.name)
      await writeFixture(root, definition.workspaceAge)
      const home = join(root, '.private-home')
      const cache = join(root, '.private-cache')
      await Promise.all([
        mkdir(home, { mode: 0o700 }),
        mkdir(cache, { mode: 0o700 }),
      ])
      const environment = minimalEnvironment(home, {
        pnpm_config_cache_dir: cache,
        ...(definition.environmentAge === undefined
          ? {}
          : { pnpm_config_minimum_release_age: definition.environmentAge }),
      })
      const policySurface = readConfig(
        commandRunner,
        root,
        environment,
        definition.cliPrefix,
        definition.expectedAge,
      )
      const observed = await installerRunner(Object.freeze({
        name: definition.name,
        cwd: root,
        storeRoot,
        pnpmExecutable: PNPM_EXECUTABLE,
        environment,
        cliPrefix: definition.cliPrefix,
        installerArguments: INSTALLER_ARGUMENTS,
        expectedOutcome: definition.expectedOutcome,
        policySurface,
      }))
      const scenario = {
        name: definition.name,
        configurationSource: definition.configurationSource,
        policySurface,
        ...observed,
      }
      scenario.diagnosticDigest = scenarioDiagnosticDigest(scenario)
      scenarios.push(requireScenario(scenario, definition.name))
    }
    const [workspaceAfter, lockfileAfter] = await Promise.all([
      readFile(join(sourceRoot, 'pnpm-workspace.yaml')),
      readFile(join(sourceRoot, 'pnpm-lock.yaml')),
    ])
    const fixtureDigest = canonicalDigest({
      packageManager: `pnpm@${PNPM_VERSION}`,
      package: SENTINEL_PACKAGE,
      version: SENTINEL_VERSION,
      integrity: SENTINEL_INTEGRITY,
      publishedAgeMinutes: 60,
      lockfileVersion: '9.0',
    })
    return requirePnpmEffectivePolicyReceipt({
      schemaVersion: 3,
      status: 'PASS',
      packageManager: `pnpm@${PNPM_VERSION}`,
      evidenceRole: 'authoritative-linux-arm64-pnpm-installer-plumbing',
      platform,
      proof: 'real-install-config-normalization-resolver-lockfile-verification',
      networkPolicy: 'buildkit-network-none-loopback-registry-sentinel-only',
      rootContractDigest: WORKER_BUILD_ROOT_CONTRACT_DIGEST,
      bundleDigest: sha256(bundleBytes),
      verifierFunctionDigest: extracted.digest,
      workspacePolicyDigest: sha256(workspaceBefore),
      lockfileDigest: sha256(lockfileBefore),
      fixtureDigest,
      installerCommandDigest: canonicalDigest(INSTALLER_ARGUMENTS),
      policyFields: POLICY_FIELDS,
      sourceInputsUnchanged: workspaceAfter.equals(workspaceBefore) && lockfileAfter.equals(lockfileBefore),
      rawConfigPersisted: false,
      sourcePolicies,
      scenarios,
      consumerDecision: 'numeric-zero-disables-lockfile-age-network-path-string-zero-does-not',
    })
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

async function main() {
  if (process.argv.length !== 2) throw new Error('pnpm effective policy verifier takes no arguments')
  const receipt = await verifyPnpmEffectivePolicy()
  process.stdout.write(`${JSON.stringify(receipt)}\n`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    // Verifier-authored diagnostics only; never persist installer output or
    // raw config, which could contain registry or authentication material.
    const detail = error instanceof Error && /^(?:pnpm |real pnpm )[a-zA-Z0-9 /.,:-]+$/u.test(error.message)
      ? `: ${error.message}` : ''
    process.stderr.write(`pnpm effective policy verification failed closed${detail}\n`)
    if (error?.diagnostic) process.stderr.write(`${JSON.stringify(error.diagnostic)}\n`)
    process.exitCode = 1
  })
}
