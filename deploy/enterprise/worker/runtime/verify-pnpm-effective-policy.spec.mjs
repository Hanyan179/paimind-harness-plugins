import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { WORKER_BUILD_ROOT_CONTRACT_DIGEST } from './worker-build-root-contract.mjs'
import {
  extractBundledResolutionVerifier,
  isTrustedRootReadOnlyMetadata,
  requirePnpmEffectivePolicyReceipt,
  verifyPnpmEffectivePolicy,
} from './verify-pnpm-effective-policy.mjs'

const POLICY_FIELDS = [
  'minimumReleaseAge',
  'minimumReleaseAgeStrict',
  'minimumReleaseAgeExclude',
  'minimumReleaseAgeIgnoreMissingTime',
  'trustPolicy',
  'trustPolicyExclude',
  'trustPolicyIgnoreAfter',
  'trustLockfile',
]
const INSTALLER_ARGUMENTS = [
  'install',
  '--lockfile-only',
  '--offline',
  '--frozen-lockfile',
  '--ignore-scripts',
  '--reporter=ndjson',
  '--frozen-store',
  '--config.side-effects-cache=false',
]
const SENTINEL_INTEGRITY = `sha512-${Buffer.alloc(64).toString('base64')}`

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

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

const verifierFunction = `function createNpmResolutionVerifier(opts3) {
  const ageCheckActive = Boolean(opts3.minimumReleaseAge);
  const trustCheckActive = opts3.trustPolicy === "no-downgrade";
  const minimumReleaseAge = opts3.minimumReleaseAge ?? 0;
  const minimumReleaseAgeExclude = opts3.minimumReleaseAgeExclude ?? [];
  const trustPolicy = opts3.trustPolicy;
  const trustPolicyExclude = opts3.trustPolicyExclude ?? [];
  const trustPolicyIgnoreAfter = opts3.trustPolicyIgnoreAfter;
  const verify = async () => {
    if (ageCheckActive) await runAgeCheck();
    if (trustCheckActive) await runTrustCheck();
    return { ok: true };
  };
  return {
    verify,
    policy: {
      tarballUrlBinding: true,
      minimumReleaseAge,
      minimumReleaseAgeExclude,
      trustPolicy: trustPolicy ?? null,
      trustPolicyExclude,
      trustPolicyIgnoreAfter
    }
  };
}
/* ${'pinned-verifier-fixture-'.repeat(80)} */
`

function policySurface(age) {
  return {
    minimumReleaseAgeType: typeof age,
    minimumReleaseAge: age,
    minimumReleaseAgeStrict: null,
    minimumReleaseAgeExclude: [],
    minimumReleaseAgeIgnoreMissingTime: null,
    trustPolicy: null,
    trustPolicyExclude: [],
    trustPolicyIgnoreAfter: null,
    trustLockfile: null,
  }
}

function scenarioDiagnostic(value) {
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

const activeRequestDigest = sha256(Buffer.from('registry-sentinel-request', 'utf8'))
const emptyRequestDigest = sha256(Buffer.alloc(0))

function scenario(name, configurationSource, age, overrides = {}) {
  const producer = name === 'producer-workspace-number-1440'
  const active = producer || name === 'consumer-cli-string-zero'
  const value = {
    name,
    configurationSource,
    policySurface: policySurface(age),
    installerOutcome: producer ? 'policy-rejected' : 'pass',
    exitCode: producer ? 1 : 0,
    errorCodes: producer ? ['ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION'] : [],
    registryRequests: active ? 1 : 0,
    registryRequestDigest: active ? activeRequestDigest : emptyRequestDigest,
    cacheFresh: true,
    lockfileUnchanged: true,
    userStoreDependency: false,
    rawOutputPersisted: false,
    ...overrides,
  }
  value.diagnosticDigest = overrides.diagnosticDigest ?? scenarioDiagnostic(value)
  return value
}

function receipt() {
  return {
    schemaVersion: 3,
    status: 'PASS',
    packageManager: 'pnpm@11.7.0',
    evidenceRole: 'authoritative-linux-arm64-pnpm-installer-plumbing',
    platform: { os: 'linux', architecture: 'arm64' },
    proof: 'real-install-config-normalization-resolver-lockfile-verification',
    networkPolicy: 'buildkit-network-none-loopback-registry-sentinel-only',
    rootContractDigest: WORKER_BUILD_ROOT_CONTRACT_DIGEST,
    bundleDigest: sha256(Buffer.from('bundle')),
    verifierFunctionDigest: sha256(Buffer.from('verifier')),
    workspacePolicyDigest: sha256(Buffer.from('workspace')),
    lockfileDigest: sha256(Buffer.from('lockfile')),
    fixtureDigest: canonicalDigest({
      packageManager: 'pnpm@11.7.0',
      package: 'paimind-policy-sentinel',
      version: '1.0.0',
      integrity: SENTINEL_INTEGRITY,
      publishedAgeMinutes: 60,
      lockfileVersion: '9.0',
    }),
    installerCommandDigest: canonicalDigest(INSTALLER_ARGUMENTS),
    policyFields: [...POLICY_FIELDS],
    sourcePolicies: { producer: policySurface(1_440), consumer: policySurface(0) },
    sourceInputsUnchanged: true,
    rawConfigPersisted: false,
    scenarios: [
      scenario('producer-workspace-number-1440', 'workspace-number', 1_440),
      scenario('consumer-cli-string-zero', 'cli-string', '0'),
      scenario('consumer-environment-number-zero', 'environment-number', 0),
      scenario('consumer-workspace-number-zero', 'workspace-number', 0),
    ],
    consumerDecision: 'numeric-zero-disables-lockfile-age-network-path-string-zero-does-not',
  }
}

test('extracts only the pinned pnpm verifier surface used by the real installer proof', () => {
  const bundle = `prefix\n${verifierFunction}async function runAgeCheck(context) { return context }\nsuffix\n`
  const extracted = extractBundledResolutionVerifier(bundle)
  assert.match(extracted.digest, /^sha256:[a-f0-9]{64}$/u)
  assert.match(extracted.source, /minimumReleaseAgeExclude/u)
  assert.match(extracted.source, /trustPolicyExclude/u)
  assert.match(extracted.source, /trustPolicyIgnoreAfter/u)
  assert.throws(() => extractBundledResolutionVerifier(`${bundle}${verifierFunction}`), /not unique/u)
})

test('accepts only the strict linux arm64 real-installer receipt and all eight policy fields', () => {
  const value = receipt()
  const accepted = requirePnpmEffectivePolicyReceipt(value)
  assert.equal(accepted.schemaVersion, 3)
  assert.deepEqual(accepted.policyFields, POLICY_FIELDS)
  assert.equal(accepted.scenarios[0].installerOutcome, 'policy-rejected')
  assert.equal(accepted.scenarios[1].registryRequests, 1)
  assert.equal(accepted.scenarios[2].registryRequests, 0)
  assert.equal(Object.isFrozen(accepted.scenarios), true)

  const mutations = [
    value => { value.platform.architecture = 'amd64' },
    value => { value.evidenceRole = 'supporting-host-policy-contract' },
    value => { value.policyFields.pop() },
    value => { delete value.sourcePolicies },
    value => { value.sourcePolicies.producer.minimumReleaseAge = '1440' },
    value => { value.sourcePolicies.consumer.minimumReleaseAge = '0' },
    value => { value.sourcePolicies.producer.minimumReleaseAgeIgnoreMissingTime = true },
    value => { value.sourcePolicies.producer.minimumReleaseAgeStrict = true },
    value => { value.scenarios[0].policySurface.minimumReleaseAgeStrict = false },
    value => { value.scenarios[1].policySurface.minimumReleaseAgeExclude = ['unsafe@1'] },
    value => { value.scenarios[2].policySurface.minimumReleaseAgeIgnoreMissingTime = 'true' },
    value => { value.scenarios[2].policySurface.trustPolicy = 'no-downgrade' },
    value => { value.scenarios[2].policySurface.trustPolicyExclude = ['unsafe@1'] },
    value => { value.scenarios[2].policySurface.trustPolicyIgnoreAfter = 1 },
    value => { value.scenarios[2].policySurface.trustLockfile = true },
    value => { value.scenarios[0].registryRequests = 0 },
    value => { value.scenarios[2].registryRequests = 1 },
    value => { value.scenarios[1].diagnosticDigest = sha256(Buffer.from('drift')) },
    value => { value.installerCommandDigest = sha256(Buffer.from('bypass')) },
    value => { value.untrusted = true },
  ]
  for (const mutate of mutations) {
    const candidate = structuredClone(receipt())
    mutate(candidate)
    assert.throws(() => requirePnpmEffectivePolicyReceipt(candidate), /pnpm effective policy/u)
  }
})

test('requires every root-owned trusted input write bit to be zero', () => {
  for (const mode of [0o400, 0o440, 0o444, 0o555]) {
    assert.equal(isTrustedRootReadOnlyMetadata({ uid: 0, gid: 0, mode }), true)
  }
  for (const mode of [0o600, 0o644, 0o664, 0o666, 0o442, 0o424, 0o244]) {
    assert.equal(isTrustedRootReadOnlyMetadata({ uid: 0, gid: 0, mode }), false)
  }
  assert.equal(isTrustedRootReadOnlyMetadata({ uid: 501, gid: 0, mode: 0o444 }), false)
  assert.equal(isTrustedRootReadOnlyMetadata({ uid: 0, gid: 20, mode: 0o444 }), false)
})

test('builds a path-free receipt from four real-installer scenario contracts without inheriting secrets', async t => {
  const root = await mkdtemp(join(tmpdir(), 'paimind-policy-spec-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const sourceRoot = join(root, 'source')
  const storeRoot = join(root, 'store')
  await Promise.all([mkdir(sourceRoot), mkdir(storeRoot)])
  await Promise.all([
    writeFile(join(sourceRoot, 'pnpm-workspace.yaml'), 'packages: []\nminimumReleaseAge: 1440\n'),
    writeFile(join(sourceRoot, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n"),
  ])
  const bundlePath = join(root, 'pnpm.mjs')
  const manifestPath = join(root, 'package.json')
  await Promise.all([
    writeFile(bundlePath, `prefix\n${verifierFunction}async function runAgeCheck(context) { return context }\nsuffix\n`),
    writeFile(manifestPath, '{"name":"pnpm","version":"11.7.0"}\n'),
  ])
  const calls = []
  const configCalls = []
  const canonicalStoreRoot = await realpath(storeRoot)
  const commandRunner = (_executable, args, options) => {
    configCalls.push({ cwd: options.cwd, args, environment: options.env })
    assert.equal(Object.hasOwn(options.env, 'PRIVATE_FIXTURE_SECRET'), false)
    const cli = args.includes('--config.minimum-release-age=0')
    const environment = options.env.pnpm_config_minimum_release_age === '0'
    const workspaceZero = options.cwd.endsWith('consumer-workspace-number-zero')
    const minimumReleaseAge = cli ? '0' : (environment || workspaceZero ? 0 : 1_440)
    return {
      status: 0,
      signal: null,
      stdout: JSON.stringify({ minimumReleaseAge }),
      stderr: '',
    }
  }
  const installerRunner = async spec => {
    calls.push(spec)
    assert.deepEqual(spec.installerArguments, INSTALLER_ARGUMENTS)
    assert.equal(spec.pnpmExecutable, '/pnpm/pnpm')
    assert.equal(spec.storeRoot, canonicalStoreRoot)
    assert.equal(Object.hasOwn(spec.environment, 'PRIVATE_FIXTURE_SECRET'), false)
    const producer = spec.name === 'producer-workspace-number-1440'
    const active = producer || spec.name === 'consumer-cli-string-zero'
    return {
      installerOutcome: producer ? 'policy-rejected' : 'pass',
      exitCode: producer ? 1 : 0,
      errorCodes: producer ? ['ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION'] : [],
      registryRequests: active ? 1 : 0,
      registryRequestDigest: active ? activeRequestDigest : emptyRequestDigest,
      cacheFresh: true,
      lockfileUnchanged: true,
      userStoreDependency: false,
      rawOutputPersisted: false,
    }
  }
  const result = await verifyPnpmEffectivePolicy({
    sourceRoot: await realpath(sourceRoot),
    expectedSourceRoot: await realpath(sourceRoot),
    storeRoot: canonicalStoreRoot,
    expectedStoreRoot: canonicalStoreRoot,
    pnpmBundlePath: await realpath(bundlePath),
    pnpmManifestPath: await realpath(manifestPath),
    requireTrustedMetadata: false,
    platform: { os: 'linux', architecture: 'arm64' },
    commandRunner,
    installerRunner,
  })
  assert.equal(result.status, 'PASS')
  assert.equal(calls.length, 4)
  assert.equal(configCalls.length, 6)
  assert.equal(configCalls[0].cwd, await realpath(sourceRoot))
  assert.equal(configCalls[1].cwd, await realpath(sourceRoot))
  assert.equal(configCalls[0].environment.pnpm_config_minimum_release_age, undefined)
  assert.equal(configCalls[1].environment.pnpm_config_minimum_release_age, '0')
  assert.deepEqual(result.sourcePolicies, { producer: policySurface(1_440), consumer: policySurface(0) })
  assert.deepEqual(calls.map(call => call.cliPrefix), [[], ['--config.minimum-release-age=0'], [], []])
  assert.equal(JSON.stringify(result).includes(root), false)
  assert.equal(JSON.stringify(result).includes('PRIVATE_FIXTURE_SECRET'), false)
  assert.equal(JSON.stringify(result).includes('http://'), false)
})

test('fails closed on config, installer, platform and source-input drift', async t => {
  const root = await mkdtemp(join(tmpdir(), 'paimind-policy-fail-spec-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const sourceRoot = join(root, 'source')
  const storeRoot = join(root, 'store')
  await Promise.all([mkdir(sourceRoot), mkdir(storeRoot)])
  await Promise.all([
    writeFile(join(sourceRoot, 'pnpm-workspace.yaml'), 'packages: []\nminimumReleaseAge: 1440\n'),
    writeFile(join(sourceRoot, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n"),
  ])
  const bundlePath = join(root, 'pnpm.mjs')
  const manifestPath = join(root, 'package.json')
  await Promise.all([
    writeFile(bundlePath, `prefix\n${verifierFunction}async function runAgeCheck(context) { return context }\nsuffix\n`),
    writeFile(manifestPath, '{"name":"pnpm","version":"11.7.0"}\n'),
  ])
  const base = {
    sourceRoot: await realpath(sourceRoot),
    expectedSourceRoot: await realpath(sourceRoot),
    storeRoot: await realpath(storeRoot),
    expectedStoreRoot: await realpath(storeRoot),
    pnpmBundlePath: await realpath(bundlePath),
    pnpmManifestPath: await realpath(manifestPath),
    requireTrustedMetadata: false,
    platform: { os: 'linux', architecture: 'arm64' },
  }
  await assert.rejects(verifyPnpmEffectivePolicy({
    ...base,
    platform: { os: 'darwin', architecture: 'arm64' },
  }), /linux\/arm64/u)
  await assert.rejects(verifyPnpmEffectivePolicy({
    ...base,
    commandRunner: () => ({ status: 0, signal: null, stdout: '{invalid}', stderr: '' }),
  }), /valid JSON/u)
  await assert.rejects(verifyPnpmEffectivePolicy({
    ...base,
    commandRunner: () => ({
      status: 0,
      signal: null,
      stdout: JSON.stringify({ minimumReleaseAge: 1_440, trustLockfile: true }),
      stderr: '',
    }),
  }), /surface is invalid or unsafe|expected minimum release age/u)
})
