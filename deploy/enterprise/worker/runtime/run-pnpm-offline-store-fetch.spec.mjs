import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { link, lstat, mkdtemp, open, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { PassThrough } from 'node:stream'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import {
  PNPM_PRODUCER_COREPACK_HOME,
  PNPM_PRODUCER_EXECUTABLE,
  PNPM_PRODUCER_FETCH_COMMAND_ARGS,
  PNPM_PRODUCER_FETCH_POLICY,
  PNPM_PRODUCER_FETCH_RUNNER_VALIDATION_REASON_CODES,
  createPnpmFetchOutputClassifier,
  createPnpmProducerFetchEnvironment,
  createPnpmProducerFetchRunner,
  isTransientPnpmFetchFailure,
  isTrustedPnpmProducerTarget,
  requirePnpmProducerFetchReceipt,
  requirePnpmProducerFetchRunnerValidationEvent,
  runPnpmOfflineStoreFetch,
  writePnpmProducerFetchReceipt,
} from './run-pnpm-offline-store-fetch.mjs'
import {
  WORKER_BUILD_ROOT_CONTRACT,
  WORKER_BUILD_ROOT_CONTRACT_DIGEST,
} from './worker-build-root-contract.mjs'

const SOURCE_ROOT = WORKER_BUILD_ROOT_CONTRACT.roots.source.path
const STORE_ROOT = WORKER_BUILD_ROOT_CONTRACT.roots.store.path
const REPORT_PATH = '/offline-store-fetch-retry.json'

function legacyResult(overrides = {}) {
  return { exitCode: 0, signal: null, timedOut: false, stdout: '', stderr: '', elapsedMs: 25, ...overrides }
}

function evidence(overrides = {}) {
  return {
    terminalClassification: null,
    transientClassifications: [],
    observedNonTransient: false,
    observedTransient: false,
    reasonCodes: [],
    allowlistedPnpmErrorCodes: [],
    unknownPnpmErrorCodeCount: 0,
    unknownPnpmErrorCodeOverflow: false,
    httpStatusCodes: [],
    outputBytes: 0,
    ...overrides,
  }
}

function safeResult(overrides = {}) {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    timeoutAuthority: 'wrapper-monotonic-watchdog',
    interrupted: false,
    elapsedMs: 5,
    stdoutExactMatch: null,
    evidence: evidence(),
    ...overrides,
  }
}

function versionResult(overrides = {}) {
  return safeResult({ stdoutExactMatch: true, ...overrides })
}

function environment(overrides = {}) {
  return {
    PAIMIND_WORKER_BUILD_SOURCE_ROOT: SOURCE_ROOT,
    PAIMIND_WORKER_PNPM_STORE_ROOT: STORE_ROOT,
    COREPACK_HOME: PNPM_PRODUCER_COREPACK_HOME,
    PATH: '/host/shadow/bin',
    HOME: '/secret/home',
    OPENAI_API_KEY: 'must-not-pass',
    HTTPS_PROXY: 'https://user:secret@proxy.invalid/?token=hidden',
    NODE_OPTIONS: '--require=/secret/hook.cjs',
    ...overrides,
  }
}

function rootPass() {
  return {
    status: 'PASS',
    contractDigest: WORKER_BUILD_ROOT_CONTRACT_DIGEST,
    requiredRoots: ['source', 'store'],
    verifiedRoots: [
      { root: 'source', ownerUid: 0, ownerGid: 0, mode: 0o755 },
      { root: 'store', ownerUid: 0, ownerGid: 0, mode: 0o755 },
    ],
  }
}

function fakeClock(initial = 0) {
  let current = initial
  let nextId = 1
  const timers = new Map()
  function runNextDue() {
    const due = [...timers.entries()]
      .filter(([, value]) => value.at <= current)
      .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0]
    if (due === undefined) return false
    timers.delete(due[0]); due[1].callback()
    return true
  }
  function runDue() {
    while (true) {
      if (!runNextDue()) break
    }
  }
  return {
    now: () => current,
    setTimer(callback, ms) { const id = nextId++; timers.set(id, { callback, at: current + ms }); return id },
    clearTimer(id) { timers.delete(id) },
    async sleep(ms, signal) {
      if (signal?.aborted) throw new Error('interrupted')
      current += ms; runDue()
      if (signal?.aborted) throw new Error('interrupted')
    },
    advance(ms) { current += ms; runDue() },
    elapseWithoutRunning(ms) { current += ms },
    flushDue: runDue,
    runNextDue,
    pendingAt: () => [...timers.values()].map(value => value.at).sort((left, right) => left - right),
    pending: () => timers.size,
  }
}

function runOptions(overrides = {}) {
  const clock = overrides.clock ?? fakeClock()
  return {
    storeRoot: STORE_ROOT,
    reportPath: REPORT_PATH,
    cwd: SOURCE_ROOT,
    environment: environment(),
    clock,
    installSignalHandlers: false,
    summary: { write() {} },
    verifyRoots: async () => rootPass(),
    verifyExecutable: async () => ({ status: 'PASS', policy: PNPM_PRODUCER_FETCH_POLICY.trustedPnpmExecutablePolicy }),
    ...overrides,
    clock,
  }
}

function parseSummaryEvents(output) {
  return output.map(value => JSON.parse(value))
}

function queuedRunner(fetchResults, observations = []) {
  let fetchIndex = 0
  return async spec => {
    observations.push(spec)
    if (spec.purpose === 'version-readback') return versionResult()
    return fetchResults[fetchIndex++]
  }
}

async function successfulReceipt(fetchResults = [legacyResult()]) {
  let written
  const receipt = await runPnpmOfflineStoreFetch(runOptions({
    runner: queuedRunner(fetchResults),
    writer: async (_path, value) => { written = value },
  }))
  assert.deepEqual(written, receipt)
  return receipt
}

test('locks exact roots, absolute Corepack entry, pnpm 11.7.0 command and bounded policy', () => {
  assert.equal(PNPM_PRODUCER_FETCH_POLICY.rootContractDigest, WORKER_BUILD_ROOT_CONTRACT_DIGEST)
  assert.equal(PNPM_PRODUCER_FETCH_POLICY.packageManager, 'pnpm@11.7.0')
  assert.equal(PNPM_PRODUCER_FETCH_POLICY.schemaVersion, 4)
  assert.equal(PNPM_PRODUCER_FETCH_POLICY.policy, 'pnpm-producer-bounded-fetch-retry-v8-native-timeout-readonly')
  assert.equal(PNPM_PRODUCER_FETCH_POLICY.maxAttempts, 2)
  assert.equal(PNPM_PRODUCER_FETCH_POLICY.perAttemptTimeoutMs, 475_000)
  assert.equal(PNPM_PRODUCER_FETCH_POLICY.killGraceMs, 5_000)
  assert.equal(PNPM_PRODUCER_FETCH_POLICY.terminalObservationSlackMs, 5_000)
  assert.equal(PNPM_PRODUCER_FETCH_POLICY.backoffMs, 15_000)
  assert.equal(PNPM_PRODUCER_FETCH_POLICY.totalBudgetMs, 990_000)
  assert.equal(PNPM_PRODUCER_FETCH_POLICY.timeoutAuthority, 'wrapper-monotonic-watchdog')
  assert.equal(PNPM_PRODUCER_EXECUTABLE, '/pnpm/pnpm')
  assert.equal(PNPM_PRODUCER_COREPACK_HOME, '/opt/paimind-enterprise-corepack-home')
  assert.ok(2 * (475_000 + 5_000 + 5_000) + 15_000 <= 990_000)
  assert.deepEqual(PNPM_PRODUCER_FETCH_COMMAND_ARGS(), [
    `--store-dir=${STORE_ROOT}`, '--package-import-method=copy',
    '--config.enable-global-virtual-store=false', 'fetch', '--frozen-lockfile', '--ignore-scripts',
  ])
  assert.throws(() => PNPM_PRODUCER_FETCH_COMMAND_ARGS('/tmp/shadow-store'), /locked Worker root/u)
  assert.doesNotMatch(PNPM_PRODUCER_FETCH_COMMAND_ARGS().join(' '), /minimum-release-age|trust-lockfile/u)
})

test('uses an exact minimal environment, disables Corepack network and rejects root or Corepack drift', () => {
  const child = createPnpmProducerFetchEnvironment(environment())
  assert.deepEqual(child, {
    PATH: '/pnpm:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    HOME: '/tmp/paimind-pnpm-producer-home', TMPDIR: '/tmp', CI: 'true', NO_COLOR: '1',
    COREPACK_HOME: PNPM_PRODUCER_COREPACK_HOME, COREPACK_ENABLE_NETWORK: '0',
    pnpm_config_cache_dir: `${STORE_ROOT}/.cache/pnpm`,
    PAIMIND_WORKER_BUILD_SOURCE_ROOT: SOURCE_ROOT, PAIMIND_WORKER_PNPM_STORE_ROOT: STORE_ROOT,
  })
  assert.equal(JSON.stringify(child).includes('secret'), false)
  assert.equal(JSON.stringify(child).includes('proxy.invalid'), false)
  assert.throws(() => createPnpmProducerFetchEnvironment(environment({ COREPACK_HOME: '/tmp/corepack' })), /COREPACK_HOME/u)
  assert.throws(() => createPnpmProducerFetchEnvironment(environment({ PAIMIND_WORKER_PNPM_STORE_ROOT: '/tmp/store' })), /root contract/u)
})

test('trusted executable rejects owner writes as well as group/other writes and link/owner drift', () => {
  const metadata = { isFile: () => true, isSymbolicLink: () => false, uid: 0, gid: 0, nlink: 1, mode: 0o100555 }
  assert.equal(isTrustedPnpmProducerTarget(metadata), true)
  for (const changed of [
    { mode: 0o100755 }, { mode: 0o100575 }, { mode: 0o100557 }, { mode: 0o100444 },
    { uid: 501 }, { gid: 20 }, { nlink: 2 }, { mode: undefined },
    { isFile: () => false }, { isSymbolicLink: () => true },
  ]) assert.equal(isTrustedPnpmProducerTarget({ ...metadata, ...changed }), false)
  assert.equal(isTrustedPnpmProducerTarget(null), false)
})

test('recognizes pinned pnpm request timeout without forging watchdog authority or retrying policy failures', async () => {
  const timeout = '[23] The operation was aborted due to timeout\n\nTimeoutError: The operation was aborted due to timeout\n'
  const classifier = createPnpmFetchOutputClassifier()
  classifier.push(timeout.slice(0, 16)); classifier.push(timeout.slice(16))
  const classified = classifier.finish()
  assert.equal(classified.terminalClassification, 'network')
  assert.equal(classified.observedNonTransient, false)
  const receipt = await successfulReceipt([
    legacyResult({ exitCode: 1, stderr: timeout, elapsedMs: 316_700 }), legacyResult(),
  ])
  assert.equal(receipt.attemptsUsed, 2)
  assert.equal(receipt.attempts[0].classification, 'network')
  assert.equal(receipt.attempts[0].timedOut, false)
  for (const neighbor of [
    'WARN [23] The operation was aborted due to timeout',
    '[24] The operation was aborted due to timeout',
    'The operation was aborted due to timeout',
    `${timeout}ERR_PNPM_TARBALL_INTEGRITY checksum mismatch`,
    `${timeout}ERR_PNPM_OUTDATED_LOCKFILE frozen-lockfile failed`,
    `${timeout}minimum release age policy failed`,
    `${timeout}HTTP 401 Unauthorized`,
    `${timeout}ERR_PNPM_FUTURE_FAILURE fatal`,
    `${timeout}ERROR HTTP 503 Service Unavailable`,
  ]) assert.equal(isTransientPnpmFetchFailure(legacyResult({ exitCode: 1, stderr: neighbor })), false, neighbor)
  assert.equal(isTransientPnpmFetchFailure(legacyResult({ exitCode: 0, stderr: timeout })), false)
  assert.throws(() => requirePnpmProducerFetchReceipt({ ...receipt,
    policy: 'pnpm-producer-bounded-fetch-retry-v7-sealed-metadata-cache' }), /locked pnpm Producer fetch contract/u)
})

test('verifies canonical roots and trusted executable before exact version readback and network fetch', async () => {
  const order = []
  const calls = []
  await runPnpmOfflineStoreFetch(runOptions({
    verifyRoots: async () => { order.push('roots'); return rootPass() },
    verifyExecutable: async path => { order.push(`executable:${path}`); return { status: 'PASS', policy: PNPM_PRODUCER_FETCH_POLICY.trustedPnpmExecutablePolicy } },
    runner: queuedRunner([legacyResult()], calls),
    writer: async () => { order.push('receipt') },
  }))
  assert.deepEqual(order, ['roots', `executable:${PNPM_PRODUCER_EXECUTABLE}`, 'receipt'])
  assert.equal(calls.length, 2)
  assert.deepEqual(calls.map(call => call.purpose), ['version-readback', 'producer-fetch'])
  assert.equal(calls[0].command, PNPM_PRODUCER_EXECUTABLE)
  assert.deepEqual(calls[0].args, ['--version'])
  assert.equal(calls[0].expectedStdout, '11.7.0\n')
  assert.equal(calls[1].command, PNPM_PRODUCER_EXECUTABLE)
  assert.equal(calls[1].environment.PATH.startsWith('/pnpm:'), true)
})

test('fails before network on root, executable or pnpm version drift with fixed path-free errors', async t => {
  const cases = [
    ['root', { verifyRoots: async () => { throw new Error(`${SOURCE_ROOT}/secret`) } }, 'ERR_PNPM_PRODUCER_FETCH_ROOTS'],
    ['root owner', { verifyRoots: async () => ({ ...rootPass(), verifiedRoots: [
      { root: 'source', ownerUid: 501, ownerGid: 20, mode: 0o755 },
      { root: 'store', ownerUid: 0, ownerGid: 0, mode: 0o755 },
    ] }) }, 'ERR_PNPM_PRODUCER_FETCH_ROOTS'],
    ['root mode', { verifyRoots: async () => ({ ...rootPass(), verifiedRoots: [
      { root: 'source', ownerUid: 0, ownerGid: 0, mode: 0o755 },
      { root: 'store', ownerUid: 0, ownerGid: 0, mode: 0o777 },
    ] }) }, 'ERR_PNPM_PRODUCER_FETCH_ROOTS'],
    ['executable', { verifyExecutable: async () => { throw new Error('/host/shadow/pnpm') } }, 'ERR_PNPM_PRODUCER_FETCH_EXECUTABLE'],
    ['version', { runner: async spec => spec.purpose === 'version-readback' ? versionResult({ stdoutExactMatch: false }) : legacyResult() }, 'ERR_PNPM_PRODUCER_FETCH_VERSION'],
  ]
  for (const [name, override, code] of cases) {
    await t.test(name, async () => {
      let writes = 0
      await assert.rejects(runPnpmOfflineStoreFetch(runOptions({ ...override, writer: async () => { writes += 1 } })), error => {
        assert.equal(error?.code, code)
        assert.doesNotMatch(error.message, /\/opt\/|\/host\/|secret/u)
        return true
      })
      assert.equal(writes, 0)
    })
  }
})

test('writes one path-free strict receipt only after first-attempt success and preserves the original summary bytes', async () => {
  const output = []
  let written
  const receipt = await runPnpmOfflineStoreFetch(runOptions({
    runner: queuedRunner([legacyResult({ stdout: `${SOURCE_ROOT} token=secret`, elapsedMs: 37 })]),
    writer: async (_path, value) => { written = value },
    summary: { write: value => output.push(value) },
  }))
  assert.deepEqual(written, receipt)
  assert.equal(receipt.rootContractDigest, WORKER_BUILD_ROOT_CONTRACT_DIGEST)
  assert.equal(receipt.trustedPnpmVersion, '11.7.0')
  assert.equal(receipt.attemptsUsed, 1)
  assert.deepEqual(receipt.attempts, [{ attempt: 1, status: 'PASS', classification: 'none', exitCode: 0, signal: null, timedOut: false, elapsedMs: 37 }])
  const serialized = `${JSON.stringify(receipt)}${output.join('')}`
  assert.doesNotMatch(serialized, /secret|token=|\/opt\/|https?:\/\//u)
  assert.equal(output.length, 1)
  assert.equal(output[0], '{"schemaVersion":1,"event":"pnpm-producer-fetch-attempt","attempt":1,"status":"PASS","classification":"none","elapsedMs":37}\n')
  const summary = JSON.parse(output[0])
  assert.deepEqual(summary, {
    schemaVersion: 1, event: 'pnpm-producer-fetch-attempt', attempt: 1,
    status: 'PASS', classification: 'none', elapsedMs: 37,
  })
})

test('treats a trusted pnpm zero exit as authoritative only for advisory generic or mixed framing', async () => {
  const classifier = createPnpmFetchOutputClassifier()
  classifier.push('Lockfile is up to date, resolution step is skipped\n')
  classifier.push('minimum release age is configured by the workspace\n')
  classifier.push('+ error-stack-parser 2.1.4\n')
  classifier.push('Lockfile is current; minimum release age is 1440; + error-stack-parser 2.1.4\n')
  const successEvidence = classifier.finish()
  assert.equal(successEvidence.observedNonTransient, false)
  assert.deepEqual(successEvidence.reasonCodes, [])

  const output = []
  let written
  const receipt = await runPnpmOfflineStoreFetch(runOptions({
    runner: queuedRunner([safeResult({ elapsedMs: 263_398, evidence: successEvidence })]),
    writer: async (_path, value) => { written = value },
    summary: { write: value => output.push(value) },
  }))

  assert.deepEqual(written, receipt)
  assert.deepEqual(receipt.attempts, [{
    attempt: 1, status: 'PASS', classification: 'none', exitCode: 0,
    signal: null, timedOut: false, elapsedMs: 263_398,
  }])
  assert.deepEqual(parseSummaryEvents(output), [{
    schemaVersion: 1, event: 'pnpm-producer-fetch-attempt', attempt: 1,
    status: 'PASS', classification: 'none', elapsedMs: 263_398,
  }])

  for (const advisoryOutput of [
    'ERROR optional fetch failed after the package manager recovered',
    'ERROR fetch failed while resolving package\ngetaddrinfo EAI_AGAIN\n',
  ]) {
    let advisoryWritten
    const advisorySummary = []
    const advisoryReceipt = await runPnpmOfflineStoreFetch(runOptions({
      runner: queuedRunner([legacyResult({ stderr: advisoryOutput, elapsedMs: 29 })]),
      writer: async (_path, value) => { advisoryWritten = value },
      summary: { write: value => advisorySummary.push(value) },
    }))
    assert.deepEqual(advisoryWritten, advisoryReceipt)
    assert.deepEqual(advisoryReceipt.attempts, [{
      attempt: 1, status: 'PASS', classification: 'none', exitCode: 0,
      signal: null, timedOut: false, elapsedMs: 29,
    }])
    const advisoryEvents = parseSummaryEvents(advisorySummary)
    assert.equal(advisoryEvents.length, 2)
    assert.equal(advisoryEvents[1].event, 'pnpm-producer-fetch-advisory-success')
    assert.deepEqual(Object.keys(advisoryEvents[1]).sort(), [
      'schemaVersion', 'event', 'attempt', 'reasonCodes', 'transientClassifications', 'diagnosticDigest',
    ].sort())
    assert.deepEqual(advisoryEvents[1].reasonCodes, advisoryOutput.includes('EAI_AGAIN')
      ? ['GENERIC_TERMINAL', 'MIXED_EVIDENCE']
      : ['GENERIC_TERMINAL'])
    assert.deepEqual(advisoryEvents[1].transientClassifications, advisoryOutput.includes('EAI_AGAIN')
      ? ['network']
      : [])
    assert.match(advisoryEvents[1].diagnosticDigest, /^sha256:[a-f0-9]{64}$/u)
    assert.doesNotMatch(advisorySummary.join(''), /optional|package|EAI_AGAIN|fetch failed/u)
  }

  for (const explicitViolation of [
    'ERR_PNPM_OUTDATED_LOCKFILE frozen-lockfile failed',
    'minimum release age policy failed',
    'integrity verification failed',
    'ERR_PNPM_FUTURE_FAILURE fatal',
    'ERR_PNPM_META_FETCH_FAIL request failed: EAI_AGAIN',
    'HTTP 401 Unauthorized',
    'ERROR optional fetch failed\nHTTP 429 Too Many Requests',
    'ERROR optional fetch failed\nHTTP 503 Service Unavailable',
    'ERROR fetch failed\u0007',
    'ERROR fetch failed\nEAI_AGAIN\n429 rate limited',
  ]) {
    let writes = 0
    await assert.rejects(runPnpmOfflineStoreFetch(runOptions({
      runner: queuedRunner([legacyResult({ stderr: explicitViolation })]),
      writer: async () => { writes += 1 },
    })), error => error?.code === 'ERR_PNPM_PRODUCER_FETCH_NON_TRANSIENT')
    assert.equal(writes, 0)
  }
})

test('retries only a terminal explicit transient failure and records actual monotonic backoff time', async () => {
  const clock = fakeClock()
  const calls = []
  const runner = async spec => {
    calls.push(spec)
    if (spec.purpose === 'version-readback') return versionResult()
    if (calls.filter(call => call.purpose === 'producer-fetch').length === 1) {
      clock.advance(100)
      return legacyResult({ exitCode: 1, stderr: 'ERR_PNPM_META_FETCH_FAIL request failed: EAI_AGAIN', elapsedMs: 100 })
    }
    clock.advance(200)
    return legacyResult({ elapsedMs: 200 })
  }
  const receipt = await runPnpmOfflineStoreFetch(runOptions({ clock, runner, writer: async () => {} }))
  assert.equal(receipt.attemptsUsed, 2)
  assert.equal(receipt.transientFailures, 1)
  assert.equal(receipt.totalElapsedMs, 15_300)
  assert.deepEqual(receipt.attempts.map(item => item.classification), ['network', 'none'])
})

test('retries one bounded generic-framed network transient but rejects every ambiguous or unsafe neighbor', async () => {
  const clock = fakeClock()
  const output = []
  const receipt = await runPnpmOfflineStoreFetch(runOptions({
    clock,
    runner: queuedRunner([
      legacyResult({
        exitCode: 1,
        stderr: 'ERROR fetch failed while resolving package\ngetaddrinfo EAI_AGAIN\n',
        elapsedMs: 41,
      }),
      legacyResult({ elapsedMs: 17 }),
    ]),
    writer: async () => {},
    summary: { write: value => output.push(value) },
  }))
  assert.equal(receipt.attemptsUsed, 2)
  assert.equal(receipt.transientFailures, 1)
  assert.equal(receipt.totalElapsedMs, 15_058)
  assert.deepEqual(receipt.attempts.map(item => item.classification), ['network', 'none'])
  const diagnostic = parseSummaryEvents(output)[1]
  assert.deepEqual(diagnostic.transientClassifications, ['network'])
  assert.deepEqual(diagnostic.reasonCodes, ['GENERIC_TERMINAL', 'MIXED_EVIDENCE'])

  const eligibleClassifier = createPnpmFetchOutputClassifier()
  eligibleClassifier.push('ERROR fetch failed while resolving package\n')
  eligibleClassifier.push('getaddrinfo EAI_')
  eligibleClassifier.push('AGAIN\n')
  const eligibleEvidence = eligibleClassifier.finish()
  assert.deepEqual(eligibleEvidence.transientClassifications, ['network'])
  assert.equal(isTransientPnpmFetchFailure(safeResult({ exitCode: 1, evidence: eligibleEvidence })), true)
  assert.equal(isTransientPnpmFetchFailure(safeResult({ exitCode: 0, evidence: eligibleEvidence })), false)
  assert.equal(isTransientPnpmFetchFailure(safeResult({
    exitCode: null, signal: 'SIGTERM', evidence: eligibleEvidence,
  })), false)
  assert.equal(isTransientPnpmFetchFailure(safeResult({
    exitCode: null, signal: 'SIGKILL', timedOut: true, evidence: eligibleEvidence,
  })), true)
  const timedOutReceipt = await successfulReceipt([
    safeResult({
      exitCode: null, signal: 'SIGKILL', timedOut: true,
      elapsedMs: 480_000, evidence: eligibleEvidence,
    }),
    legacyResult({ elapsedMs: 13 }),
  ])
  assert.equal(timedOutReceipt.attempts[0].classification, 'timeout')
  assert.equal(timedOutReceipt.attempts[0].timedOut, true)
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    assert.equal(isTransientPnpmFetchFailure(safeResult({
      exitCode: null, signal, timedOut: true, evidence: eligibleEvidence,
    })), true, signal)
  }

  for (const text of [
    'ERROR fetch failed\nEAI_AGAIN\n429 rate limited\n',
    'ERROR fetch failed\nEAI_AGAIN\n503 Service Unavailable\n',
    'ERROR fetch failed\nEAI_AGAIN\nminimum release age policy failed\n',
    'ERROR fetch failed\nEAI_AGAIN\nERR_PNPM_FUTURE_FAILURE fatal\n',
    'ERROR fetch failed\nEAI_AGAIN\nHTTP 401 Unauthorized\n',
    'ERROR fetch failed\nEAI_AGAIN\u0007\n',
  ]) {
    const classifier = createPnpmFetchOutputClassifier()
    classifier.push(text)
    assert.equal(isTransientPnpmFetchFailure(safeResult({
      exitCode: null, signal: 'SIGKILL', timedOut: true, evidence: classifier.finish(),
    })), false, text)
  }
  assert.equal(isTransientPnpmFetchFailure(safeResult({
    exitCode: null, signal: 'SIGKILL', timedOut: true,
    evidence: evidence({
      transientClassifications: ['network'], observedTransient: true, observedNonTransient: true,
      reasonCodes: ['GENERIC_TERMINAL', 'MIXED_EVIDENCE'],
      allowlistedPnpmErrorCodes: ['ERR_PNPM_META_FETCH_FAIL'],
    }),
  })), false)
  assert.throws(() => isTransientPnpmFetchFailure(safeResult({
    exitCode: null, signal: 'SIGKILL', timedOut: true, interrupted: true, evidence: eligibleEvidence,
  })), /runner validation/u)
  assert.throws(() => isTransientPnpmFetchFailure(safeResult({
    exitCode: null, signal: 'SIGKILL', timedOut: true,
    timeoutAuthority: 'forged-timeout-authority', evidence: eligibleEvidence,
  })), /runner validation/u)

  for (const text of [
    'ERROR fetch failed\nEAI_AGAIN\n429 rate limited\n',
    'ERROR fetch failed\nEAI_AGAIN\n503 Service Unavailable\n',
    'ERROR fetch failed\nEAI_AGAIN\nminimum release age policy failed\n',
    'ERROR fetch failed\nEAI_AGAIN\nERR_PNPM_FUTURE_FAILURE fatal\n',
    'ERROR fetch failed\nEAI_AGAIN\nHTTP 401 Unauthorized\n',
    'ERROR fetch failed\nEAI_AGAIN\u0007\n',
  ]) {
    assert.equal(isTransientPnpmFetchFailure(legacyResult({ exitCode: 1, stderr: text })), false, text)
  }
  const ambiguous = createPnpmFetchOutputClassifier()
  ambiguous.push('ERROR fetch failed\nEAI_AGAIN\n429 rate limited\n')
  const ambiguousEvidence = ambiguous.finish()
  assert.deepEqual(ambiguousEvidence.transientClassifications, ['network', 'rate-limit'])
  assert.deepEqual(ambiguousEvidence.reasonCodes, [
    'GENERIC_TERMINAL', 'MIXED_EVIDENCE', 'TRANSIENT_CLASS_AMBIGUITY',
  ])
  assert.equal(isTransientPnpmFetchFailure(legacyResult({
    exitCode: 1,
    stdout: 'ERROR fetch failed while resolving package\n',
    stderr: 'getaddrinfo EAI_AGAIN\n',
  })), true)
  for (const crossStreamAmbiguity of ['429 rate limited', '503 Service Unavailable']) {
    assert.equal(isTransientPnpmFetchFailure(legacyResult({
      exitCode: 1,
      stdout: 'ERROR fetch failed while resolving package\ngetaddrinfo EAI_AGAIN\n',
      stderr: `${crossStreamAmbiguity}\n`,
    })), false, crossStreamAmbiguity)
  }
})

test('retries a timeout only when the result carries the wrapper monotonic authority', async () => {
  const receipt = await successfulReceipt([
    safeResult({
      exitCode: null,
      signal: 'SIGKILL',
      timedOut: true,
      elapsedMs: 485_000,
      evidence: evidence(),
    }),
    legacyResult({ elapsedMs: 10 }),
  ])
  assert.equal(receipt.attempts[0].classification, 'timeout')
  assert.equal(receipt.attempts[0].timedOut, true)
  assert.equal(receipt.totalElapsedMs, 500_010)
})

test('streaming classification never retries evicted, mixed, warning, policy, unknown pnpm or ordinary 4xx output', () => {
  const classifier = createPnpmFetchOutputClassifier()
  classifier.push('ERR_PNPM_OUTDATED_LOCKFILE frozen-lockfile failed\n')
  classifier.push('x'.repeat(140 * 1_024))
  classifier.push('\nERR_PNPM_META_FETCH_FAIL request failed: EAI_')
  classifier.push('AGAIN\n')
  const fullEvidence = classifier.finish()
  assert.equal(fullEvidence.outputBytes > 128 * 1_024, true)
  assert.equal(fullEvidence.observedNonTransient, true)
  assert.deepEqual(fullEvidence.transientClassifications, ['network'])
  assert.deepEqual(fullEvidence.allowlistedPnpmErrorCodes, ['ERR_PNPM_META_FETCH_FAIL', 'ERR_PNPM_OUTDATED_LOCKFILE'])
  assert.deepEqual(fullEvidence.reasonCodes, ['GENERIC_TERMINAL', 'MIXED_EVIDENCE', 'POLICY_OR_LOCKFILE'])
  assert.equal(fullEvidence.unknownPnpmErrorCodeCount, 0)
  assert.equal(isTransientPnpmFetchFailure(safeResult({ exitCode: 1, evidence: fullEvidence })), false)

  const generic = createPnpmFetchOutputClassifier()
  generic.push('ERROR lifecycle failed without a network classification')
  generic.push('x'.repeat(140 * 1_024))
  generic.push('\nERR_PNPM_META_FETCH_FAIL request failed: EAI_AGAIN\n')
  const genericEvidence = generic.finish()
  assert.equal(genericEvidence.observedNonTransient, true)
  assert.deepEqual(genericEvidence.transientClassifications, ['network'])
  assert.deepEqual(genericEvidence.reasonCodes, ['GENERIC_TERMINAL', 'MIXED_EVIDENCE'])

  const cases = [
    legacyResult({ exitCode: 1, stderr: 'WARN request failed: EAI_AGAIN' }),
    legacyResult({ exitCode: 1, stderr: 'WARN EAI_AGAIN\nERR_PNPM_FUTURE_FAILURE fatal' }),
    legacyResult({ exitCode: 1, stderr: 'ERR_PNPM_META_FETCH_FAIL request failed: EAI_AGAIN\nHTTP 401 Unauthorized' }),
    legacyResult({ exitCode: 1, stderr: 'supply-chain policy failed\nrequest failed: EAI_AGAIN' }),
    legacyResult({ exitCode: 0, stderr: 'ERR_PNPM_META_FETCH_FAIL request failed: EAI_AGAIN' }),
  ]
  for (const value of cases) assert.equal(isTransientPnpmFetchFailure(value), false)
  for (const terminal of ['ECONNREFUSED', 'ENOTFOUND', 'ENETUNREACH', 'EHOSTUNREACH', 'TLS connection closed']) {
    assert.equal(isTransientPnpmFetchFailure(legacyResult({
      exitCode: 1,
      stderr: `ERR_PNPM_META_FETCH_FAIL request failed: ${terminal}`,
    })), false, terminal)
  }
  assert.equal(isTransientPnpmFetchFailure(legacyResult({ exitCode: 1, stderr: 'ERR_PNPM_META_FETCH_FAIL request failed: EAI_AGAIN' })), true)
  assert.equal(isTransientPnpmFetchFailure(legacyResult({ exitCode: 1, stderr: 'ERROR response: 429 Too Many Requests' })), true)
  assert.equal(isTransientPnpmFetchFailure(legacyResult({ exitCode: 1, stderr: 'ERROR HTTP 503 Service Unavailable' })), true)
  assert.equal(isTransientPnpmFetchFailure(legacyResult({
    exitCode: 1,
    stdout: 'ERR_PNPM_META_FETCH_',
    stderr: 'FAIL request failed: EAI_AGAIN',
  })), false)
})

test('failure diagnostics expose only fixed safe facts and preserve the original attempt summary event', async () => {
  const output = []
  await assert.rejects(runPnpmOfflineStoreFetch(runOptions({
    runner: queuedRunner([legacyResult({
      exitCode: 1,
      stderr: `\u001b[31mERR_PNPM_NO_OFFLINE_TARBALL ${SOURCE_ROOT}/secret file:///private/key Bearer token https://user:pass@example.invalid/?token=hidden\u001b[0m`,
      elapsedMs: 47,
    })]),
    writer: async () => { throw new Error('must not write') },
    summary: { write: value => output.push(value) },
  })), error => error?.code === 'ERR_PNPM_PRODUCER_FETCH_NON_TRANSIENT')

  const events = parseSummaryEvents(output)
  assert.equal(events.length, 2)
  assert.deepEqual(events[0], {
    schemaVersion: 1, event: 'pnpm-producer-fetch-attempt', attempt: 1,
    status: 'FAIL_CLOSED', classification: 'none', elapsedMs: 47,
  })
  assert.deepEqual(Object.keys(events[1]).sort(), [
    'schemaVersion', 'event', 'attempt', 'status', 'classification', 'exitCode', 'signal',
    'timedOut', 'outputBytes', 'observedTransient', 'observedNonTransient', 'reasonCodes',
    'transientClassifications',
    'pnpmErrorCodes', 'unknownPnpmErrorCodeCount', 'unknownPnpmErrorCodeOverflow',
    'httpStatusCodes', 'elapsedMs', 'diagnosticDigest',
  ].sort())
  assert.equal(events[1].event, 'pnpm-producer-fetch-diagnostic')
  assert.equal(events[1].exitCode, 1)
  assert.equal(events[1].signal, null)
  assert.equal(events[1].timedOut, false)
  assert.deepEqual(events[1].pnpmErrorCodes, ['ERR_PNPM_NO_OFFLINE_TARBALL'])
  assert.deepEqual(events[1].reasonCodes, ['CONTROL_SEQUENCE', 'GENERIC_TERMINAL', 'POLICY_OR_LOCKFILE'])
  assert.equal(events[1].unknownPnpmErrorCodeCount, 0)
  assert.equal(events[1].unknownPnpmErrorCodeOverflow, false)
  assert.match(events[1].diagnosticDigest, /^sha256:[a-f0-9]{64}$/u)
  assert.doesNotMatch(output.join(''), /secret|private|Bearer|token|example\.invalid|file:\/\/|\u001b|\/opt\//iu)
})

test('diagnostics retain only syntactically bound HTTP status values', () => {
  for (const [line, expected] of [
    ['ERROR HTTP 404 Not Found secret-pin=499', [404]],
    ['ERROR status code: 503 Service Unavailable build-pin=588', [503]],
    ['ERROR response=429 Too Many Requests account-pin=471', [429]],
  ]) {
    const classifier = createPnpmFetchOutputClassifier()
    classifier.push(line)
    const value = classifier.finish()
    assert.deepEqual(value.httpStatusCodes, expected, line)
  }
})

test('control-sequence payloads and boundaries always fail closed instead of manufacturing transient evidence', () => {
  for (const [name, chunks] of [
    ['OSC', ['ERR_PNPM_META_FETCH_FAIL \u001b]0;EAI_AGAIN\u0007\n']],
    ['DCS', ['ERR_PNPM_META_FETCH_FAIL \u001bPprivate EAI_AGAIN\u001b\\\n']],
    ['C1', ['ERR_PNPM_META_FETCH_FAIL \u009dprivate EAI_AGAIN\u009c\n']],
    ['split OSC', ['ERR_PNPM_META_FETCH_FAIL \u001b]', '0;EAI_', 'AGAIN\u0007\n']],
    ['evicted OSC', ['ERR_PNPM_META_FETCH_FAIL \u001b]', 'x'.repeat(70 * 1_024), ' EAI_AGAIN\u0007\n']],
  ]) {
    const classifier = createPnpmFetchOutputClassifier()
    for (const chunk of chunks) classifier.push(chunk)
    const value = classifier.finish()
    assert.equal(value.observedNonTransient, true, name)
    assert.equal(value.reasonCodes.includes('CONTROL_SEQUENCE'), true, name)
    assert.equal(isTransientPnpmFetchFailure(safeResult({ exitCode: 1, evidence: value })), false, name)
  }
})

test('summary sink failures cannot change PASS, retry or fixed fail-closed outcomes', async t => {
  const throwingSummary = { write() { throw new Error('SUMMARY_SINK_FAILURE secret=/private/path') } }

  await t.test('PASS', async () => {
    let written
    const receipt = await runPnpmOfflineStoreFetch(runOptions({
      runner: queuedRunner([legacyResult({ elapsedMs: 13 })]),
      writer: async (_path, value) => { written = value },
      summary: throwingSummary,
    }))
    assert.deepEqual(written, receipt)
    assert.equal(receipt.attemptsUsed, 1)
  })

  await t.test('transient retry', async () => {
    let written
    const receipt = await runPnpmOfflineStoreFetch(runOptions({
      runner: queuedRunner([
        legacyResult({ exitCode: 1, stderr: 'ERR_PNPM_META_FETCH_FAIL request failed: EAI_AGAIN', elapsedMs: 11 }),
        legacyResult({ elapsedMs: 7 }),
      ]),
      writer: async (_path, value) => { written = value },
      summary: throwingSummary,
    }))
    assert.deepEqual(written, receipt)
    assert.equal(receipt.attemptsUsed, 2)
    assert.equal(receipt.transientFailures, 1)
  })

  await t.test('non-transient failure', async () => {
    await assert.rejects(runPnpmOfflineStoreFetch(runOptions({
      runner: queuedRunner([legacyResult({ exitCode: 1, stderr: 'ERR_PNPM_NO_OFFLINE_TARBALL', elapsedMs: 5 })]),
      writer: async () => { throw new Error('must not write') },
      summary: throwingSummary,
    })), error => {
      assert.equal(error?.code, 'ERR_PNPM_PRODUCER_FETCH_NON_TRANSIENT')
      assert.doesNotMatch(error.message, /SUMMARY_SINK_FAILURE|secret|private/u)
      return true
    })
  })
})

test('unknown pnpm codes are counted with bounded memory and never become a secret fingerprint', async () => {
  async function failureDiagnostic(secret, elapsedMs) {
    const output = []
    const line = `ERR_PNPM_SECRET_${secret.toUpperCase()} fatal /tmp/private-${secret} Bearer ${secret} https://${secret}.invalid/?token=${secret}`
    await assert.rejects(runPnpmOfflineStoreFetch(runOptions({
      runner: queuedRunner([legacyResult({ exitCode: 1, stderr: line, elapsedMs })]),
      writer: async () => { throw new Error('must not write') },
      summary: { write: value => output.push(value) },
    })), error => error?.code === 'ERR_PNPM_PRODUCER_FETCH_NON_TRANSIENT')
    const diagnostic = parseSummaryEvents(output)[1]
    assert.equal(diagnostic.unknownPnpmErrorCodeCount, 1)
    assert.equal(diagnostic.unknownPnpmErrorCodeOverflow, false)
    assert.deepEqual(diagnostic.pnpmErrorCodes, [])
    assert.deepEqual(diagnostic.reasonCodes, ['GENERIC_TERMINAL', 'UNKNOWN_PNPM_CODE'])
    assert.doesNotMatch(output.join(''), new RegExp(secret, 'iu'))
    return diagnostic
  }

  const alpha = await failureDiagnostic('alpha', 11)
  const bravo = await failureDiagnostic('bravo', 97)
  assert.equal(alpha.outputBytes, bravo.outputBytes)
  assert.equal(alpha.diagnosticDigest, bravo.diagnosticDigest)

  const classifier = createPnpmFetchOutputClassifier()
  classifier.push(Array.from({ length: 1_100 }, (_, index) => `ERR_PNPM_PRIVATE_${index}`).join(' '))
  const bounded = classifier.finish()
  assert.equal(bounded.unknownPnpmErrorCodeCount, 1_024)
  assert.equal(bounded.unknownPnpmErrorCodeOverflow, true)
  assert.deepEqual(bounded.reasonCodes, ['GENERIC_TERMINAL', 'UNKNOWN_PNPM_CODE'])
  assert.deepEqual(bounded.allowlistedPnpmErrorCodes, [])
})

test('diagnostics recognize split allowlisted codes, empty terminals and normalized signals without changing retry behavior', async t => {
  await t.test('split allowlisted code', () => {
    const classifier = createPnpmFetchOutputClassifier()
    classifier.push('ERR_PNPM_NO_OFFLINE_')
    classifier.push('TARBALL frozen-lockfile failed\n')
    const value = classifier.finish()
    assert.deepEqual(value.allowlistedPnpmErrorCodes, ['ERR_PNPM_NO_OFFLINE_TARBALL'])
    assert.deepEqual(value.reasonCodes, ['GENERIC_TERMINAL', 'POLICY_OR_LOCKFILE'])
    assert.equal(isTransientPnpmFetchFailure(safeResult({ exitCode: 1, evidence: value })), false)
  })

  await t.test('empty nonzero terminal', async () => {
    const output = []
    await assert.rejects(runPnpmOfflineStoreFetch(runOptions({
      runner: queuedRunner([legacyResult({ exitCode: 1, elapsedMs: 9 })]),
      writer: async () => { throw new Error('must not write') },
      summary: { write: value => output.push(value) },
    })), error => error?.code === 'ERR_PNPM_PRODUCER_FETCH_NON_TRANSIENT')
    const diagnostic = parseSummaryEvents(output)[1]
    assert.deepEqual(diagnostic.reasonCodes, ['NO_TERMINAL_EVIDENCE'])
    assert.equal(diagnostic.outputBytes, 0)
  })

  await t.test('unknown process signal', async () => {
    const output = []
    await assert.rejects(runPnpmOfflineStoreFetch(runOptions({
      runner: queuedRunner([safeResult({ exitCode: null, signal: 'SIGUSR1', elapsedMs: 7 })]),
      writer: async () => { throw new Error('must not write') },
      summary: { write: value => output.push(value) },
    })), error => error?.code === 'ERR_PNPM_PRODUCER_FETCH_NON_TRANSIENT')
    const diagnostic = parseSummaryEvents(output)[1]
    assert.equal(diagnostic.signal, 'OTHER_SIGNAL')
    assert.deepEqual(diagnostic.reasonCodes, ['PROCESS_SIGNAL'])
  })
})

test('transient diagnostics are additive while the eventual success receipt and PASS summary remain unchanged', async () => {
  const output = []
  let written
  const receipt = await runPnpmOfflineStoreFetch(runOptions({
    runner: queuedRunner([
      legacyResult({ exitCode: 1, stderr: 'ERR_PNPM_META_FETCH_FAIL request failed: EAI_AGAIN', elapsedMs: 31 }),
      legacyResult({ elapsedMs: 17 }),
    ]),
    writer: async (_path, value) => { written = value },
    summary: { write: value => output.push(value) },
  }))
  assert.deepEqual(written, receipt)
  assert.deepEqual(Object.keys(receipt).sort(), [
    'schemaVersion', 'status', 'packageManager', 'policy', 'rootContractDigest',
    'trustedPnpmVersion', 'trustedPnpmExecutablePolicy', 'corepackPolicy', 'maxAttempts',
    'perAttemptTimeoutMs', 'killGraceMs', 'terminalObservationSlackMs', 'backoffMs', 'totalBudgetMs',
    'producerMinimumReleaseAgeMinutes', 'networkPolicy', 'userStoreDependency',
    'timeoutAuthority', 'attemptsUsed', 'transientFailures', 'totalElapsedMs', 'attempts',
  ].sort())
  assert.deepEqual(Object.keys(receipt.attempts[0]).sort(), [
    'attempt', 'status', 'classification', 'exitCode', 'signal', 'timedOut', 'elapsedMs',
  ].sort())
  const events = parseSummaryEvents(output)
  assert.deepEqual(events.map(event => event.event), [
    'pnpm-producer-fetch-attempt', 'pnpm-producer-fetch-diagnostic', 'pnpm-producer-fetch-attempt',
  ])
  assert.equal(events[1].classification, 'network')
  assert.deepEqual(events[1].pnpmErrorCodes, ['ERR_PNPM_META_FETCH_FAIL'])
  assert.deepEqual(events[1].reasonCodes, [])
  assert.deepEqual(events[2], {
    schemaVersion: 1, event: 'pnpm-producer-fetch-attempt', attempt: 2,
    status: 'PASS', classification: 'none', elapsedMs: 17,
  })
})

class FakeChild extends EventEmitter {
  constructor(pid = 42) {
    super(); this.pid = pid; this.stdout = new PassThrough(); this.stderr = new PassThrough()
  }
}

test('runner keeps stdout and stderr byte streams separate before merging safe evidence', async () => {
  const clock = fakeClock()
  const child = new FakeChild()
  const runner = createPnpmProducerFetchRunner({
    spawn: () => child, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
    killProcessGroup() { throw new Error('must not terminate') },
  })
  const pending = runner({ purpose: 'producer-fetch', command: PNPM_PRODUCER_EXECUTABLE, args: [], cwd: SOURCE_ROOT,
    environment: createPnpmProducerFetchEnvironment(environment()), timeoutMs: 475_000,
    killGraceMs: 5_000, terminalObservationSlackMs: 5_000,
    signal: new AbortController().signal })
  child.stdout.write('ERR_PNPM_META_FETCH_')
  child.stderr.write('FAIL request failed: EAI_AGAIN\n')
  child.emit('close', 1, null)
  const value = await pending
  assert.equal(value.evidence.observedNonTransient, true)
  assert.equal(value.evidence.observedTransient, true)
  assert.deepEqual(value.evidence.allowlistedPnpmErrorCodes, [])
  assert.equal(value.evidence.unknownPnpmErrorCodeCount, 1)
  assert.deepEqual(value.evidence.reasonCodes, ['GENERIC_TERMINAL', 'MIXED_EVIDENCE', 'UNKNOWN_PNPM_CODE'])
  assert.equal(isTransientPnpmFetchFailure(value), false)
})

test('runner timeout is authoritative only from its monotonic watchdog and terminates the whole process group TERM then KILL', async () => {
  const clock = fakeClock()
  const child = new FakeChild()
  const signals = []
  const runner = createPnpmProducerFetchRunner({
    spawn: () => child, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
    killProcessGroup: (pid, signal) => signals.push([pid, signal]),
  })
  let settled = false
  const pending = runner({ purpose: 'producer-fetch', command: PNPM_PRODUCER_EXECUTABLE, args: [], cwd: SOURCE_ROOT,
    environment: createPnpmProducerFetchEnvironment(environment()), timeoutMs: 475_000,
    killGraceMs: 5_000, terminalObservationSlackMs: 5_000,
    signal: new AbortController().signal }).then(value => { settled = true; return value })
  child.stderr.write('token=secret https://user:pw@example.invalid/?token=x ')
  child.stderr.write(`${SOURCE_ROOT} ERR_PNPM_META_FETCH_FAIL request failed: EAI_`)
  child.stderr.write('AGAIN\n')
  clock.advance(475_000)
  assert.deepEqual(signals, [[42, 'SIGTERM']])
  child.emit('close', null, 'SIGTERM')
  await Promise.resolve()
  assert.equal(settled, false)
  clock.advance(5_000)
  const value = await pending
  assert.deepEqual(signals, [[42, 'SIGTERM'], [42, 'SIGKILL']])
  assert.equal(value.timedOut, true)
  assert.equal(value.timeoutAuthority, 'wrapper-monotonic-watchdog')
  assert.equal(value.elapsedMs, 480_000)
  assert.doesNotMatch(JSON.stringify(value), /secret|example\.invalid|\/opt\//u)
})

test('runner catches up absolute TERM and KILL deadlines under bounded watchdog jitter', async t => {
  for (const jitterMs of [1, 2_000, 6_000, 9_000]) {
    await t.test(`+${jitterMs}ms`, async () => {
      const clock = fakeClock()
      const child = new FakeChild()
      const signals = []
      const runner = createPnpmProducerFetchRunner({
        spawn: () => child, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
        killProcessGroup: (pid, signal) => signals.push([pid, signal]),
      })
      const pending = runner({ purpose: 'producer-fetch', command: PNPM_PRODUCER_EXECUTABLE,
        args: [], cwd: SOURCE_ROOT, environment: createPnpmProducerFetchEnvironment(environment()),
        timeoutMs: 475_000, killGraceMs: 5_000, terminalObservationSlackMs: 5_000,
        signal: new AbortController().signal })

      clock.elapseWithoutRunning(475_000 + jitterMs)
      clock.flushDue()
      if (jitterMs < 5_000) {
        assert.deepEqual(signals, [[42, 'SIGTERM']])
        assert.deepEqual(clock.pendingAt(), [480_000, 485_000])
        child.emit('close', null, 'SIGTERM')
        clock.advance(5_000 - jitterMs)
      } else {
        assert.deepEqual(signals, [[42, 'SIGTERM'], [42, 'SIGKILL']])
        assert.deepEqual(clock.pendingAt(), [485_000])
        child.emit('close', null, 'SIGKILL')
      }
      const result = await pending
      assert.equal(result.elapsedMs, Math.max(480_000, 475_000 + jitterMs))
      assert.equal(result.timedOut, true)
      assert.deepEqual(signals, [[42, 'SIGTERM'], [42, 'SIGKILL']])
      assert.equal(clock.pending(), 0)
    })
  }
})

test('runner includes spawn overhead in the absolute operation deadline', async () => {
  const clock = fakeClock()
  const child = new FakeChild()
  const signals = []
  const runner = createPnpmProducerFetchRunner({
    spawn: () => { clock.elapseWithoutRunning(2_000); return child },
    now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
    killProcessGroup: (pid, signal) => signals.push([pid, signal]),
  })
  const pending = runner({ purpose: 'producer-fetch', command: PNPM_PRODUCER_EXECUTABLE,
    args: [], cwd: SOURCE_ROOT, environment: createPnpmProducerFetchEnvironment(environment()),
    timeoutMs: 475_000, killGraceMs: 5_000, terminalObservationSlackMs: 5_000,
    signal: new AbortController().signal })
  clock.advance(472_999)
  assert.deepEqual(signals, [])
  clock.advance(1)
  assert.deepEqual(signals, [[42, 'SIGTERM']])
  child.emit('close', null, 'SIGTERM')
  clock.advance(5_000)
  const result = await pending
  assert.equal(result.elapsedMs, 480_000)
  assert.equal(result.timedOut, true)
  assert.equal(clock.pending(), 0)
})

test('runner never accepts a zero exit observed at or after the operation deadline', async t => {
  await t.test('one millisecond before deadline passes', async () => {
    const clock = fakeClock()
    const child = new FakeChild()
    const runner = createPnpmProducerFetchRunner({
      spawn: () => child, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
      killProcessGroup() { throw new Error('must not terminate') },
    })
    const pending = runner({ purpose: 'producer-fetch', command: PNPM_PRODUCER_EXECUTABLE,
      args: [], cwd: SOURCE_ROOT, environment: createPnpmProducerFetchEnvironment(environment()),
      timeoutMs: 475_000, killGraceMs: 5_000, terminalObservationSlackMs: 5_000,
      signal: new AbortController().signal })
    clock.elapseWithoutRunning(474_999)
    child.emit('close', 0, null)
    const result = await pending
    assert.equal(result.elapsedMs, 474_999)
    assert.equal(result.timedOut, false)
    assert.equal(clock.pending(), 0)
  })

  for (const lateByMs of [0, 1]) {
    await t.test(`deadline+${lateByMs}`, async () => {
      const clock = fakeClock()
      const child = new FakeChild()
      const signals = []
      const runner = createPnpmProducerFetchRunner({
        spawn: () => child, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
        killProcessGroup: (pid, signal) => signals.push([pid, signal]),
      })
      const pending = runner({ purpose: 'producer-fetch', command: PNPM_PRODUCER_EXECUTABLE,
        args: [], cwd: SOURCE_ROOT, environment: createPnpmProducerFetchEnvironment(environment()),
        timeoutMs: 475_000, killGraceMs: 5_000, terminalObservationSlackMs: 5_000,
        signal: new AbortController().signal })
      const rejected = assert.rejects(pending, error => error?.reasonCode === 'OPERATION_DEADLINE_EXCEEDED')
      clock.elapseWithoutRunning(475_000 + lateByMs)
      child.emit('close', 0, null)
      clock.advance(5_000 - lateByMs)
      await rejected
      assert.deepEqual(signals, [[42, 'SIGTERM'], [42, 'SIGKILL']])
      assert.equal(clock.pending(), 0)
    })
  }
})

test('runner bounds post-KILL terminal observation and never waits forever for close', async t => {
  await t.test('close inside observation slack', async () => {
    const clock = fakeClock()
    const child = new FakeChild()
    const runner = createPnpmProducerFetchRunner({
      spawn: () => child, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
      killProcessGroup() {},
    })
    const pending = runner({ purpose: 'producer-fetch', command: PNPM_PRODUCER_EXECUTABLE,
      args: [], cwd: SOURCE_ROOT, environment: createPnpmProducerFetchEnvironment(environment()),
      timeoutMs: 475_000, killGraceMs: 5_000, terminalObservationSlackMs: 5_000,
      signal: new AbortController().signal })
    clock.advance(475_000)
    clock.advance(5_000)
    clock.advance(4_000)
    child.emit('close', null, 'SIGKILL')
    const result = await pending
    assert.equal(result.elapsedMs, 484_000)
    assert.equal(clock.pending(), 0)
  })

  await t.test('missing close at observation deadline', async () => {
    const clock = fakeClock()
    const child = new FakeChild()
    const runner = createPnpmProducerFetchRunner({
      spawn: () => child, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
      killProcessGroup() {},
    })
    const pending = runner({ purpose: 'producer-fetch', command: PNPM_PRODUCER_EXECUTABLE,
      args: [], cwd: SOURCE_ROOT, environment: createPnpmProducerFetchEnvironment(environment()),
      timeoutMs: 475_000, killGraceMs: 5_000, terminalObservationSlackMs: 5_000,
      signal: new AbortController().signal })
    const rejected = assert.rejects(pending, error => {
      assert.equal(error?.reasonCode, 'TERMINAL_OBSERVATION_DEADLINE')
      assert.doesNotMatch(error.message, /secret|\/opt\//u)
      return true
    })
    clock.advance(475_000)
    clock.advance(5_000)
    clock.advance(5_000)
    await rejected
    assert.equal(clock.pending(), 0)
  })
})

test('runner fails at the absolute observation deadline after late watchdog dispatch and still attempts group cleanup', async () => {
  const clock = fakeClock()
  const child = new FakeChild()
  const runner = createPnpmProducerFetchRunner({
    spawn: () => child, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
    killProcessGroup() {},
  })
  const pending = runner({ purpose: 'producer-fetch', command: PNPM_PRODUCER_EXECUTABLE,
    args: [], cwd: SOURCE_ROOT, environment: createPnpmProducerFetchEnvironment(environment()),
    timeoutMs: 475_000, killGraceMs: 5_000, terminalObservationSlackMs: 5_000,
    signal: new AbortController().signal })
  const rejected = assert.rejects(pending, error => error?.reasonCode === 'TERMINAL_OBSERVATION_DEADLINE')
  clock.elapseWithoutRunning(485_001)
  clock.flushDue()
  await rejected
  assert.equal(clock.pending(), 0)
})

test('runner validation events use an exact fixed schema and never expose rejected raw errors', async () => {
  assert.deepEqual(PNPM_PRODUCER_FETCH_RUNNER_VALIDATION_REASON_CODES, [
    'SPAWN_THROW', 'SPAWN_ERROR_EVENT', 'RUNNER_SPEC_INVALID', 'RESULT_SHAPE_INVALID',
    'TERMINAL_TUPLE_INVALID', 'OPERATION_DEADLINE_EXCEEDED', 'ELAPSED_BOUND_EXCEEDED', 'EVIDENCE_SCHEMA_INVALID',
    'TERMINAL_OBSERVATION_DEADLINE', 'OTHER_RUNNER_VALIDATION',
  ])
  const output = []
  await assert.rejects(runPnpmOfflineStoreFetch(runOptions({
    runner: async spec => {
      if (spec.purpose === 'version-readback') return versionResult()
      return safeResult({ elapsedMs: 485_001 })
    },
    writer: async () => { throw new Error('must not write') },
    summary: { write: value => output.push(value) },
  })), error => error?.code === 'ERR_PNPM_PRODUCER_FETCH_RUNNER')
  const [event] = parseSummaryEvents(output)
  assert.deepEqual(Object.keys(event).sort(), [
    'schemaVersion', 'event', 'purpose', 'attempt', 'reasonCode', 'diagnosticDigest',
  ].sort())
  assert.equal(event.purpose, 'producer-fetch')
  assert.equal(event.attempt, 1)
  assert.equal(event.reasonCode, 'ELAPSED_BOUND_EXCEEDED')
  assert.deepEqual(requirePnpmProducerFetchRunnerValidationEvent(event), event)
  for (const mutate of [
    value => { value.extra = true },
    value => { value.reasonCode = 'RAW_SECRET_REASON' },
    value => { value.attempt = null },
    value => { value.diagnosticDigest = `sha256:${'0'.repeat(64)}` },
  ]) {
    const candidate = structuredClone(event); mutate(candidate)
    assert.throws(() => requirePnpmProducerFetchRunnerValidationEvent(candidate), /validation event/u)
  }

  output.length = 0
  await assert.rejects(runPnpmOfflineStoreFetch(runOptions({
    runner: async spec => {
      if (spec.purpose === 'version-readback') return versionResult()
      throw new Error(`${SOURCE_ROOT}/secret Bearer token https://user:pass@example.invalid`)
    },
    writer: async () => { throw new Error('must not write') },
    summary: { write: value => output.push(value) },
  })), error => error?.code === 'ERR_PNPM_PRODUCER_FETCH_RUNNER')
  assert.equal(parseSummaryEvents(output)[0].reasonCode, 'OTHER_RUNNER_VALIDATION')
  assert.doesNotMatch(output.join(''), /secret|Bearer|example\.invalid|\/opt\//u)

  const forged = {
    code: 'ERR_PNPM_PRODUCER_FETCH_RUNNER_VALIDATION',
    reasonCode: 'SPAWN_THROW',
  }
  const throwingGetter = Object.create(null, {
    code: { get() { throw new Error(`${SOURCE_ROOT}/secret https://user:pass@example.invalid`) } },
    reasonCode: { get() { throw new Error('Bearer secret') } },
  })
  const throwingProxy = new Proxy({}, {
    get() { throw new Error(`${SOURCE_ROOT}/secret Bearer https://user:pass@example.invalid`) },
  })
  for (const rejectedValue of [forged, throwingGetter, throwingProxy]) {
    output.length = 0
    await assert.rejects(runPnpmOfflineStoreFetch(runOptions({
      runner: async spec => {
        if (spec.purpose === 'version-readback') return versionResult()
        throw rejectedValue
      },
      writer: async () => { throw new Error('must not write') },
      summary: { write: value => output.push(value) },
    })), error => error?.code === 'ERR_PNPM_PRODUCER_FETCH_RUNNER')
    const [safeEvent] = parseSummaryEvents(output)
    assert.equal(safeEvent.reasonCode, 'OTHER_RUNNER_VALIDATION')
    assert.doesNotMatch(output.join(''), /secret|Bearer|example\.invalid|\/opt\//u)
  }
})

test('CLI wrapper writes one safe validation event before its fixed error on the real stderr stream', () => {
  const moduleUrl = new URL('./run-pnpm-offline-store-fetch.mjs', import.meta.url).href
  const program = `
    import {
      PNPM_PRODUCER_COREPACK_HOME,
      PNPM_PRODUCER_FETCH_POLICY,
      runPnpmOfflineStoreFetchCli,
    } from ${JSON.stringify(moduleUrl)}
    const evidence = {
      terminalClassification: null,
      transientClassifications: [],
      observedNonTransient: false,
      observedTransient: false,
      reasonCodes: [],
      allowlistedPnpmErrorCodes: [],
      unknownPnpmErrorCodeCount: 0,
      unknownPnpmErrorCodeOverflow: false,
      httpStatusCodes: [],
      outputBytes: 0,
    }
    const safeResult = overrides => ({
      exitCode: 0,
      signal: null,
      timedOut: false,
      timeoutAuthority: PNPM_PRODUCER_FETCH_POLICY.timeoutAuthority,
      interrupted: false,
      elapsedMs: 5,
      stdoutExactMatch: null,
      evidence,
      ...overrides,
    })
    const exitCode = await runPnpmOfflineStoreFetchCli({
      storeRoot: ${JSON.stringify(STORE_ROOT)},
      reportPath: ${JSON.stringify(REPORT_PATH)},
      cwd: ${JSON.stringify(SOURCE_ROOT)},
      environment: {
        PAIMIND_WORKER_BUILD_SOURCE_ROOT: ${JSON.stringify(SOURCE_ROOT)},
        PAIMIND_WORKER_PNPM_STORE_ROOT: ${JSON.stringify(STORE_ROOT)},
        COREPACK_HOME: PNPM_PRODUCER_COREPACK_HOME,
      },
      installSignalHandlers: false,
      verifyRoots: async () => (${JSON.stringify(rootPass())}),
      verifyExecutable: async () => ({
        status: 'PASS',
        policy: PNPM_PRODUCER_FETCH_POLICY.trustedPnpmExecutablePolicy,
      }),
      runner: async spec => spec.purpose === 'version-readback'
        ? safeResult({ stdoutExactMatch: true })
        : safeResult({ elapsedMs: 485001 }),
      writer: async () => { throw new Error('must not write') },
    })
    process.exitCode = exitCode
  `
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', program], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
  })
  assert.equal(child.status, 1)
  assert.equal(child.stdout, '')
  const lines = child.stderr.trimEnd().split('\n')
  assert.equal(lines.length, 2)
  const event = JSON.parse(lines[0])
  assert.equal(event.reasonCode, 'ELAPSED_BOUND_EXCEEDED')
  assert.deepEqual(requirePnpmProducerFetchRunnerValidationEvent(event), event)
  assert.equal(lines[1], 'pnpm Producer fetch runner failed closed')
  assert.doesNotMatch(child.stderr, /secret|Bearer|https?:\/\/|\/opt\//u)
})

test('high-level runner validation diagnostics preserve exact purpose and fixed branch reasons', async t => {
  const cases = [
    ['version result shape', 'version-readback', { exitCode: 0 }, 'RESULT_SHAPE_INVALID', 'ERR_PNPM_PRODUCER_FETCH_VERSION'],
    ['producer result shape', 'producer-fetch', { exitCode: 0 }, 'RESULT_SHAPE_INVALID', 'ERR_PNPM_PRODUCER_FETCH_RUNNER'],
    ['producer terminal tuple', 'producer-fetch', safeResult({ exitCode: 1, signal: 'SIGTERM' }), 'TERMINAL_TUPLE_INVALID', 'ERR_PNPM_PRODUCER_FETCH_RUNNER'],
    ['producer evidence schema', 'producer-fetch', safeResult({ evidence: evidence({ extra: true }) }), 'EVIDENCE_SCHEMA_INVALID', 'ERR_PNPM_PRODUCER_FETCH_RUNNER'],
  ]
  for (const [name, failingPurpose, rejectedResult, reasonCode, publicCode] of cases) {
    await t.test(name, async () => {
      const output = []
      await assert.rejects(runPnpmOfflineStoreFetch(runOptions({
        runner: async spec => spec.purpose === failingPurpose ? rejectedResult : versionResult(),
        writer: async () => { throw new Error('must not write') },
        summary: { write: value => output.push(value) },
      })), error => error?.code === publicCode)
      const [event] = parseSummaryEvents(output)
      assert.equal(output.length, 1)
      assert.equal(event.purpose, failingPurpose)
      assert.equal(event.attempt, failingPurpose === 'version-readback' ? null : 1)
      assert.equal(event.reasonCode, reasonCode)
      assert.deepEqual(requirePnpmProducerFetchRunnerValidationEvent(event), event)
    })
  }
})

test('high-level diagnostics retain private provenance for real spawn and observation failures', async t => {
  async function runActualFailure(mode) {
    const clock = fakeClock()
    const output = []
    let spawnCount = 0
    const runner = createPnpmProducerFetchRunner({
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      killProcessGroup() {},
      spawn: () => {
        spawnCount += 1
        if (spawnCount === 1) {
          const child = new FakeChild(101)
          queueMicrotask(() => {
            child.stdout.write('11.7.0\n')
            child.emit('close', 0, null)
          })
          return child
        }
        if (mode === 'spawn-throw') throw new Error(`${SOURCE_ROOT}/secret Bearer token`)
        const child = new FakeChild(102)
        if (mode === 'spawn-error') {
          queueMicrotask(() => child.emit('error', new Error(`${SOURCE_ROOT}/secret Bearer token`)))
        } else {
          queueMicrotask(() => {
            clock.advance(475_000)
            clock.advance(5_000)
            clock.advance(5_000)
          })
        }
        return child
      },
    })
    await assert.rejects(runPnpmOfflineStoreFetch(runOptions({
      clock,
      runner,
      writer: async () => { throw new Error('must not write') },
      summary: { write: value => output.push(value) },
    })), error => error?.code === 'ERR_PNPM_PRODUCER_FETCH_RUNNER')
    assert.equal(output.length, 1)
    assert.doesNotMatch(output.join(''), /secret|Bearer|\/opt\//u)
    assert.equal(clock.pending(), 0)
    return parseSummaryEvents(output)[0]
  }

  for (const [mode, reasonCode] of [
    ['spawn-throw', 'SPAWN_THROW'],
    ['spawn-error', 'SPAWN_ERROR_EVENT'],
    ['observation-deadline', 'TERMINAL_OBSERVATION_DEADLINE'],
  ]) {
    await t.test(mode, async () => {
      const event = await runActualFailure(mode)
      assert.equal(event.reasonCode, reasonCode)
      assert.deepEqual(requirePnpmProducerFetchRunnerValidationEvent(event), event)
    })
  }
})

test('spawn failures and invalid runner specs retain only fixed validation reasons', async () => {
  const clock = fakeClock()
  const child = new FakeChild()
  const runner = createPnpmProducerFetchRunner({
    spawn: () => child, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
    killProcessGroup() {},
  })
  const pending = runner({ purpose: 'producer-fetch', command: PNPM_PRODUCER_EXECUTABLE,
    args: [], cwd: SOURCE_ROOT, environment: createPnpmProducerFetchEnvironment(environment()),
    timeoutMs: 475_000, killGraceMs: 5_000, terminalObservationSlackMs: 5_000,
    signal: new AbortController().signal })
  child.emit('error', new Error(`${SOURCE_ROOT}/secret Bearer token`))
  await assert.rejects(pending, error => {
    assert.equal(error?.reasonCode, 'SPAWN_ERROR_EVENT')
    assert.doesNotMatch(error.message, /secret|Bearer|\/opt\//u)
    return true
  })

  const throwingRunner = createPnpmProducerFetchRunner({
    spawn: () => { throw new Error(`${SOURCE_ROOT}/secret Bearer token`) },
    now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
    killProcessGroup() {},
  })
  await assert.rejects(throwingRunner({
    purpose: 'producer-fetch', command: PNPM_PRODUCER_EXECUTABLE,
    args: [], cwd: SOURCE_ROOT, environment: createPnpmProducerFetchEnvironment(environment()),
    timeoutMs: 475_000, killGraceMs: 5_000, terminalObservationSlackMs: 5_000,
    signal: new AbortController().signal,
  }), error => {
    assert.equal(error?.reasonCode, 'SPAWN_THROW')
    assert.doesNotMatch(error.message, /secret|Bearer|\/opt\//u)
    return true
  })

  const invalid = runner({ purpose: 'producer-fetch', command: PNPM_PRODUCER_EXECUTABLE,
    args: [], cwd: SOURCE_ROOT, environment: createPnpmProducerFetchEnvironment(environment()),
    timeoutMs: 475_000, killGraceMs: 5_000,
    signal: new AbortController().signal })
  await assert.rejects(invalid, error => error?.reasonCode === 'RUNNER_SPEC_INVALID')
})

test('runner rejects an impossible exit-code and signal tuple before returning it to any caller', async () => {
  const clock = fakeClock()
  const child = new FakeChild()
  const runner = createPnpmProducerFetchRunner({
    spawn: () => child, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
    killProcessGroup() { throw new Error('must not terminate') },
  })
  const pending = runner({ purpose: 'producer-fetch', command: PNPM_PRODUCER_EXECUTABLE, args: [], cwd: SOURCE_ROOT,
    environment: createPnpmProducerFetchEnvironment(environment()), timeoutMs: 475_000,
    killGraceMs: 5_000, terminalObservationSlackMs: 5_000,
    signal: new AbortController().signal })
  child.emit('close', 143, 'SIGTERM')
  await assert.rejects(pending, error => error?.reasonCode === 'TERMINAL_TUPLE_INVALID')
})

test('child exit 124 or 137 is not a timeout unless the wrapper watchdog fired', async t => {
  for (const code of [124, 137]) {
    await t.test(`${code}`, async () => {
      const clock = fakeClock()
      const child = new FakeChild(code)
      const runner = createPnpmProducerFetchRunner({
        spawn: () => child, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
        killProcessGroup() { throw new Error('must not terminate') },
      })
      const pending = runner({ purpose: 'producer-fetch', command: PNPM_PRODUCER_EXECUTABLE, args: [], cwd: SOURCE_ROOT,
        environment: createPnpmProducerFetchEnvironment(environment()), timeoutMs: 475_000,
        killGraceMs: 5_000, terminalObservationSlackMs: 5_000,
        signal: new AbortController().signal })
      child.emit('close', code, null)
      const value = await pending
      assert.equal(value.timedOut, false)
      assert.equal(isTransientPnpmFetchFailure(value), false)
    })
  }
})

test('abort terminates and waits for the active process group without leaving descendants', async () => {
  const clock = fakeClock()
  const child = new FakeChild(99)
  const signals = []
  const controller = new AbortController()
  const runner = createPnpmProducerFetchRunner({
    spawn: () => child, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
    killProcessGroup: (pid, signal) => signals.push([pid, signal]),
  })
  const pending = runner({ purpose: 'producer-fetch', command: PNPM_PRODUCER_EXECUTABLE, args: [], cwd: SOURCE_ROOT,
    environment: createPnpmProducerFetchEnvironment(environment()), timeoutMs: 475_000,
    killGraceMs: 5_000, terminalObservationSlackMs: 5_000,
    signal: controller.signal })
  controller.abort(); child.emit('close', null, 'SIGTERM'); clock.advance(5_000)
  const value = await pending
  assert.equal(value.interrupted, true)
  assert.deepEqual(signals, [[99, 'SIGTERM'], [99, 'SIGKILL']])
})

test('global monotonic deadline includes runners, backoff and termination reserve and never writes on expiry', async () => {
  const clock = fakeClock()
  let fetchAttempt = 0
  let writes = 0
  const runner = async spec => {
    if (spec.purpose === 'version-readback') return versionResult()
    fetchAttempt += 1
    if (fetchAttempt === 1) {
      clock.advance(480_000)
      return safeResult({
        exitCode: null, signal: 'SIGKILL', timedOut: true, elapsedMs: 480_000,
        evidence: evidence({
          terminalClassification: 'network', transientClassifications: ['network'], observedTransient: true,
        }),
      })
    }
    clock.advance(491_000)
    return safeResult({ exitCode: null, signal: 'SIGKILL', interrupted: true, elapsedMs: 480_000 })
  }
  await assert.rejects(runPnpmOfflineStoreFetch(runOptions({
    clock, runner, writer: async () => { writes += 1 },
  })), error => error?.code === 'ERR_PNPM_PRODUCER_FETCH_DEADLINE')
  assert.equal(writes, 0)
  assert.equal(clock.now() >= 985_000, true)
})

test('global deadline remains authoritative when a late runner validation failure races the abort', async () => {
  const clock = fakeClock()
  const output = []
  let writes = 0
  await assert.rejects(runPnpmOfflineStoreFetch(runOptions({
    clock,
    runner: async spec => {
      if (spec.purpose === 'version-readback') return versionResult()
      clock.advance(980_000)
      return safeResult({ elapsedMs: 485_001 })
    },
    writer: async () => { writes += 1 },
    summary: { write: value => output.push(value) },
  })), error => error?.code === 'ERR_PNPM_PRODUCER_FETCH_DEADLINE')
  const [event] = parseSummaryEvents(output)
  assert.equal(event.event, 'pnpm-producer-fetch-runner-validation')
  assert.equal(event.reasonCode, 'ELAPSED_BOUND_EXCEEDED')
  assert.equal(writes, 0)
  assert.equal(clock.pending(), 0)
})

test('version readback interruption reports the authoritative process signal or global deadline', async t => {
  await t.test('process SIGINT', async () => {
    const before = process.listenerCount('SIGINT')
    await assert.rejects(runPnpmOfflineStoreFetch(runOptions({
      installSignalHandlers: true,
      runner: async spec => {
        assert.equal(spec.purpose, 'version-readback')
        process.emit('SIGINT')
        return safeResult({
          exitCode: null,
          signal: 'SIGTERM',
          interrupted: true,
          stdoutExactMatch: true,
        })
      },
    })), error => error?.code === 'ERR_PNPM_PRODUCER_FETCH_INTERRUPTED')
    assert.equal(process.listenerCount('SIGINT'), before)
  })

  await t.test('global deadline', async () => {
    const clock = fakeClock()
    await assert.rejects(runPnpmOfflineStoreFetch(runOptions({
      clock,
      runner: async spec => {
        assert.equal(spec.purpose, 'version-readback')
        clock.advance(980_000)
        return safeResult({
          exitCode: null,
          signal: 'SIGTERM',
          interrupted: true,
          stdoutExactMatch: true,
        })
      },
    })), error => error?.code === 'ERR_PNPM_PRODUCER_FETCH_DEADLINE')
    assert.equal(clock.pending(), 0)
  })
})

test('version time and the first bounded timeout dynamically crop the second attempt inside the total budget', async () => {
  const clock = fakeClock()
  const fetchTimeouts = []
  let fetchAttempt = 0
  const receipt = await runPnpmOfflineStoreFetch(runOptions({
    clock,
    runner: async spec => {
      if (spec.purpose === 'version-readback') {
        clock.advance(10_000)
        return versionResult({ elapsedMs: 10_000 })
      }
      fetchAttempt += 1
      fetchTimeouts.push(spec.timeoutMs)
      if (fetchAttempt === 1) {
        clock.advance(485_000)
        return safeResult({
          exitCode: null, signal: 'SIGKILL', timedOut: true, elapsedMs: 485_000,
        })
      }
      clock.advance(10)
      return safeResult({ elapsedMs: 10 })
    },
    writer: async () => {},
  }))
  assert.deepEqual(fetchTimeouts, [475_000, 470_000])
  assert.equal(receipt.totalElapsedMs, 510_010)
  assert.equal(receipt.attemptsUsed, 2)
  assert.equal(clock.pending(), 0)
})

test('receipt commit is bounded by the same monotonic deadline and exposes only a fixed failure', async t => {
  await t.test('aborted real writer releases its handle and removes the late receipt', async t => {
    const root = await mkdtemp(join(tmpdir(), 'paimind-pnpm-fetch-deadline-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const reportPath = join(root, 'receipt.json')
    const clock = fakeClock()
    let writerStarted = false
    let writerReleased = false
    let resolveWriterStarted
    const writerStartedPromise = new Promise(resolvePromise => { resolveWriterStarted = resolvePromise })
    const pending = runPnpmOfflineStoreFetch(runOptions({
      clock,
      reportPath,
      runner: queuedRunner([legacyResult()]),
      receiptWriterHooks: {
        afterWrite: async ({ signal }) => {
          writerStarted = true
          resolveWriterStarted()
          if (!signal.aborted) {
            await new Promise(resolvePromise => signal.addEventListener('abort', resolvePromise, { once: true }))
          }
          writerReleased = true
        },
      },
    }))
    await writerStartedPromise
    assert.equal(writerStarted, true)
    clock.advance(985_000)
    await assert.rejects(pending, error => {
      assert.equal(error?.code, 'ERR_PNPM_PRODUCER_FETCH_DEADLINE')
      assert.doesNotMatch(error.message, /secret|\/opt\//u)
      return true
    })
    assert.equal(writerReleased, true)
    await assert.rejects(lstat(reportPath), error => error?.code === 'ENOENT')
    assert.equal(clock.pending(), 0)
  })

  await t.test('late writer return', async () => {
    const clock = fakeClock()
    await assert.rejects(runPnpmOfflineStoreFetch(runOptions({
      clock,
      runner: queuedRunner([legacyResult()]),
      writer: async () => { clock.advance(985_000) },
    })), error => error?.code === 'ERR_PNPM_PRODUCER_FETCH_DEADLINE')
  })

  await t.test('writer error is normalized', async () => {
    await assert.rejects(runPnpmOfflineStoreFetch(runOptions({
      runner: queuedRunner([legacyResult()]),
      writer: async () => { throw new Error(`${SOURCE_ROOT}/secret`) },
    })), error => {
      assert.equal(error?.code, 'ERR_PNPM_PRODUCER_FETCH_RECEIPT')
      assert.doesNotMatch(error.message, /secret|\/opt\//u)
      return true
    })
  })
})

test('non-transient and exhausted attempts never write a receipt and expose only fixed safe summaries', async t => {
  for (const [name, results, code] of [
    ['non-transient', [legacyResult({ exitCode: 1, stderr: `ERR_PNPM_OUTDATED_LOCKFILE ${SOURCE_ROOT} token=secret` })], 'ERR_PNPM_PRODUCER_FETCH_NON_TRANSIENT'],
    ['exhausted', [legacyResult({ exitCode: 1, stderr: 'ERR_PNPM_META_FETCH_FAIL EAI_AGAIN' }), legacyResult({ exitCode: 1, stderr: 'ERROR HTTP 503 Service Unavailable' })], 'ERR_PNPM_PRODUCER_FETCH_EXHAUSTED'],
    ['generic-network-exhausted', [
      legacyResult({ exitCode: 1, stderr: 'ERROR fetch failed\ngetaddrinfo EAI_AGAIN\n' }),
      legacyResult({ exitCode: 1, stderr: 'ERROR fetch failed\ngetaddrinfo EAI_AGAIN\n' }),
    ], 'ERR_PNPM_PRODUCER_FETCH_EXHAUSTED'],
  ]) {
    await t.test(name, async () => {
      const output = []
      let writes = 0
      await assert.rejects(runPnpmOfflineStoreFetch(runOptions({
        runner: queuedRunner(results), writer: async () => { writes += 1 },
        summary: { write: value => output.push(value) },
      })), error => { assert.equal(error?.code, code); assert.doesNotMatch(error.message, /secret|\/opt\//u); return true })
      assert.equal(writes, 0)
      assert.doesNotMatch(output.join(''), /secret|token=|\/opt\/|https?:\/\//u)
    })
  }
})

test('strict receipt coherence rejects success-transient, timeout mismatch and schema drift', async () => {
  const receipt = await successfulReceipt([
    legacyResult({ exitCode: 1, stderr: 'ERR_PNPM_META_FETCH_FAIL EAI_AGAIN', elapsedMs: 10 }),
    legacyResult({ elapsedMs: 20 }),
  ])
  assert.deepEqual(requirePnpmProducerFetchReceipt(receipt), receipt)
  const mutations = [
    value => { delete value.rootContractDigest },
    value => { value.extra = true },
    value => { value.rootContractDigest = `sha256:${'0'.repeat(64)}` },
    value => { value.trustedPnpmVersion = '11.7.1' },
    value => { value.corepackPolicy = 'network-download-allowed' },
    value => { value.totalElapsedMs = 1 },
    value => { value.attempts[0].exitCode = 0 },
    value => { value.attempts[0].timedOut = true },
    value => { value.attempts[0].classification = 'timeout'; value.attempts[0].timedOut = false },
    value => { value.attempts[0].exitCode = 1; value.attempts[0].signal = 'SIGTERM' },
    value => { value.attempts[0].exitCode = null; value.attempts[0].signal = null },
    value => {
      value.attempts[0].classification = 'timeout'; value.attempts[0].timedOut = true
      value.attempts[0].exitCode = 1; value.attempts[0].signal = null
    },
    value => {
      value.attempts[0].exitCode = null; value.attempts[0].signal = 'SIGTERM'
      value.attempts[0].timedOut = false
    },
    value => { value.attempts[1].classification = 'network' },
    value => { value.attempts[0].secret = 'leak' },
  ]
  for (const mutate of mutations) {
    const candidate = structuredClone(receipt); mutate(candidate)
    assert.throws(() => requirePnpmProducerFetchReceipt(candidate), /receipt|attempt/u)
  }
})

test('receipt writer enforces O_NOFOLLOW, O_EXCL, 0600, nlink=1 and same-size byte stability', async t => {
  const root = await mkdtemp(join(tmpdir(), 'paimind-pnpm-fetch-receipt-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const receipt = await successfulReceipt()
  const path = join(root, 'receipt.json')
  await writePnpmProducerFetchReceipt(path, receipt)
  const metadata = await lstat(path)
  assert.equal(metadata.isFile(), true); assert.equal(metadata.nlink, 1); assert.equal(metadata.mode & 0o777, 0o600)
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), receipt)
  await assert.rejects(writePnpmProducerFetchReceipt(path, receipt), /already exists/u)

  const symlinkPath = join(root, 'symlink.json')
  await symlink(join(root, 'target.json'), symlinkPath)
  await assert.rejects(writePnpmProducerFetchReceipt(symlinkPath, receipt), /symbolic link|already exists/u)

  const abortDuringOpenPath = join(root, 'abort-during-open.json')
  const abortDuringOpen = new AbortController()
  await assert.rejects(writePnpmProducerFetchReceipt(abortDuringOpenPath, receipt, {
    signal: abortDuringOpen.signal,
    afterOpen: async () => { abortDuringOpen.abort() },
  }), /aborted/u)
  await assert.rejects(lstat(abortDuringOpenPath), error => error?.code === 'ENOENT')

  const hardPath = join(root, 'hard.json'); const second = join(root, 'second.json')
  await assert.rejects(writePnpmProducerFetchReceipt(hardPath, receipt, {
    afterWrite: async ({ path: created }) => { await link(created, second) },
  }), /changed while being committed/u)
  assert.equal((await lstat(second)).size, 0)

  const rewritePath = join(root, 'rewrite.json')
  await assert.rejects(writePnpmProducerFetchReceipt(rewritePath, receipt, {
    afterWrite: async ({ path: created }) => {
      const bytes = await readFile(created)
      const replacement = Buffer.alloc(bytes.byteLength, 0x78)
      const handle = await open(created, 'r+'); await handle.write(replacement, 0, replacement.length, 0); await handle.close()
    },
  }), /changed while being committed/u)
  await assert.rejects(lstat(rewritePath), error => error?.code === 'ENOENT')
})

test('invalid runner results fail closed and CLI accepts only the fixed receipt path', async t => {
  for (const value of [
    { exitCode: 0 },
    safeResult({ timeoutAuthority: 'exit-code-guess' }),
    safeResult({ exitCode: null, signal: null }),
    safeResult({ exitCode: 1, signal: 'SIGTERM' }),
    safeResult({ exitCode: 1, signal: null, timedOut: true }),
    safeResult({ exitCode: null, signal: 'SIGINT', timedOut: true }),
    safeResult({ exitCode: null, signal: 'SIGKILL', timedOut: true, interrupted: true }),
    safeResult({ evidence: evidence({ allowlistedPnpmErrorCodes: ['ERR_PNPM_OK'] }) }),
    safeResult({ evidence: evidence({ transientClassifications: ['dns'], observedTransient: true }) }),
    safeResult({ evidence: evidence({ transientClassifications: ['network', 'network'], observedTransient: true }) }),
    safeResult({ evidence: evidence({ transientClassifications: ['rate-limit', 'network'], observedTransient: true }) }),
    safeResult({ evidence: evidence({ transientClassifications: ['network'] }) }),
    safeResult({ evidence: evidence({ observedNonTransient: true }) }),
    safeResult({ evidence: evidence({ transientClassifications: ['network'], observedTransient: true, observedNonTransient: true, reasonCodes: ['MIXED_EVIDENCE'] }) }),
    safeResult({ evidence: evidence({ terminalClassification: 'network', transientClassifications: ['network'], observedTransient: true, observedNonTransient: true, reasonCodes: ['GENERIC_TERMINAL', 'MIXED_EVIDENCE'] }) }),
    safeResult({ evidence: evidence({ reasonCodes: ['/secret/path'], observedNonTransient: true }) }),
    safeResult({ evidence: evidence({ unknownPnpmErrorCodeCount: 1 }) }),
    safeResult({ evidence: evidence({ unknownPnpmErrorCodeOverflow: true }) }),
    safeResult({ evidence: evidence({ httpStatusCodes: [399] }) }),
    safeResult({ evidence: evidence({ httpStatusCodes: [401] }) }),
  ]) {
    await assert.rejects(runPnpmOfflineStoreFetch(runOptions({
      runner: async spec => spec.purpose === 'version-readback' ? versionResult() : value,
      writer: async () => { throw new Error('must not write') },
    })), /runner failed closed/u)
  }
  const source = new URL('./run-pnpm-offline-store-fetch.mjs', import.meta.url)
  const child = spawnSync(process.execPath, [source.pathname, '--report=/tmp/not-authoritative.json'], {
    encoding: 'utf8', env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      PAIMIND_WORKER_BUILD_SOURCE_ROOT: SOURCE_ROOT,
      PAIMIND_WORKER_PNPM_STORE_ROOT: STORE_ROOT,
      COREPACK_HOME: PNPM_PRODUCER_COREPACK_HOME,
    },
  })
  assert.equal(child.status, 1)
  assert.match(child.stderr, /requires exactly --report=\/offline-store-fetch-retry\.json/u)
  assert.doesNotMatch(child.stderr, /secret|token|\/opt\//u)
})
