#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { lstat, open, realpath, unlink } from 'node:fs/promises'
import { isAbsolute, relative, sep } from 'node:path'
import { performance } from 'node:perf_hooks'
import { TextDecoder } from 'node:util'
import { fileURLToPath } from 'node:url'
import {
  WORKER_BUILD_ROOT_CONTRACT,
  WORKER_BUILD_ROOT_CONTRACT_DIGEST,
  verifyWorkerBuildRootContract,
} from './worker-build-root-contract.mjs'

const NO_FOLLOW = fsConstants.O_NOFOLLOW ?? 0
const RECEIPT_PATH = '/offline-store-fetch-retry.json'
const SOURCE_ROOT = WORKER_BUILD_ROOT_CONTRACT.roots.source.path
const STORE_ROOT = WORKER_BUILD_ROOT_CONTRACT.roots.store.path
const SOURCE_ROOT_VARIABLE = WORKER_BUILD_ROOT_CONTRACT.roots.source.environmentVariable
const STORE_ROOT_VARIABLE = WORKER_BUILD_ROOT_CONTRACT.roots.store.environmentVariable
const FIXED_PATH = '/pnpm:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
const TRUSTED_COREPACK_ROOT = '/usr/local/lib/node_modules/corepack'
export const PNPM_PRODUCER_COREPACK_HOME = '/opt/paimind-enterprise-corepack-home'
export const PNPM_PRODUCER_EXECUTABLE = '/pnpm/pnpm'

const RECEIPT_KEYS = Object.freeze([
  'schemaVersion', 'status', 'packageManager', 'policy', 'rootContractDigest',
  'trustedPnpmVersion', 'trustedPnpmExecutablePolicy', 'corepackPolicy',
  'maxAttempts', 'perAttemptTimeoutMs', 'killGraceMs', 'terminalObservationSlackMs',
  'backoffMs', 'totalBudgetMs',
  'producerMinimumReleaseAgeMinutes', 'networkPolicy', 'userStoreDependency',
  'timeoutAuthority', 'attemptsUsed', 'transientFailures', 'totalElapsedMs', 'attempts',
])
const ATTEMPT_KEYS = Object.freeze([
  'attempt', 'status', 'classification', 'exitCode', 'signal', 'timedOut', 'elapsedMs',
])
const LEGACY_RESULT_KEYS = Object.freeze(['exitCode', 'signal', 'timedOut', 'stdout', 'stderr', 'elapsedMs'])
const SAFE_RESULT_KEYS = Object.freeze([
  'exitCode', 'signal', 'timedOut', 'timeoutAuthority', 'interrupted', 'elapsedMs',
  'stdoutExactMatch', 'evidence',
])
const EVIDENCE_KEYS = Object.freeze([
  'terminalClassification', 'transientClassifications', 'observedNonTransient', 'observedTransient',
  'reasonCodes', 'allowlistedPnpmErrorCodes', 'unknownPnpmErrorCodeCount',
  'unknownPnpmErrorCodeOverflow', 'httpStatusCodes', 'outputBytes',
])
const TRANSIENT_CLASSIFICATIONS = Object.freeze(['timeout', 'network', 'rate-limit', 'server-error'])
const OUTPUT_TRANSIENT_CLASSIFICATIONS = Object.freeze(['network', 'rate-limit', 'server-error'])
const DIAGNOSTIC_REASON_CODES = Object.freeze([
  'CONTROL_SEQUENCE', 'GENERIC_TERMINAL', 'HTTP_CLIENT_4XX', 'MIXED_EVIDENCE',
  'NO_TERMINAL_EVIDENCE', 'POLICY_OR_LOCKFILE', 'PROCESS_SIGNAL',
  'TRANSIENT_CLASS_AMBIGUITY', 'UNKNOWN_PNPM_CODE', 'WATCHDOG_TIMEOUT',
])
const DIAGNOSTIC_PNPM_ERROR_CODES = Object.freeze([
  'ERR_PNPM_BAD_TARBALL',
  'ERR_PNPM_BROKEN_LOCKFILE',
  'ERR_PNPM_FETCH_404',
  'ERR_PNPM_INVALID_WORKSPACE_CONFIGURATION',
  'ERR_PNPM_LOCKFILE_MISSING_DEPENDENCY',
  'ERR_PNPM_META_FETCH_FAIL',
  'ERR_PNPM_MISMATCHED_RELEASE_CHANNEL',
  'ERR_PNPM_NO_MATCHING_VERSION_INSIDE_WORKSPACE',
  'ERR_PNPM_NO_OFFLINE_TARBALL',
  'ERR_PNPM_OUTDATED_LOCKFILE',
  'ERR_PNPM_PEER_DEP_ISSUES',
  'ERR_PNPM_TARBALL_INTEGRITY',
  'ERR_PNPM_UNEXPECTED_PKG_CONTENT_IN_STORE',
  'ERR_PNPM_UNSUPPORTED_ENGINE',
])
const DIAGNOSTIC_PNPM_ERROR_CODE_SET = new Set(DIAGNOSTIC_PNPM_ERROR_CODES)
const DIAGNOSTIC_SIGNALS = new Set(['SIGHUP', 'SIGINT', 'SIGKILL', 'SIGQUIT', 'SIGTERM'])
const RUNNER_PURPOSES = Object.freeze(['version-readback', 'producer-fetch'])
export const PNPM_PRODUCER_FETCH_RUNNER_VALIDATION_REASON_CODES = Object.freeze([
  'SPAWN_THROW',
  'SPAWN_ERROR_EVENT',
  'RUNNER_SPEC_INVALID',
  'RESULT_SHAPE_INVALID',
  'TERMINAL_TUPLE_INVALID',
  'OPERATION_DEADLINE_EXCEEDED',
  'ELAPSED_BOUND_EXCEEDED',
  'EVIDENCE_SCHEMA_INVALID',
  'TERMINAL_OBSERVATION_DEADLINE',
  'OTHER_RUNNER_VALIDATION',
])
const RUNNER_VALIDATION_EVENT_KEYS = Object.freeze([
  'schemaVersion', 'event', 'purpose', 'attempt', 'reasonCode', 'diagnosticDigest',
])
const RUNNER_VALIDATION_ERROR_REASONS = new WeakMap()
const FIXED_ERROR_DETAILS = new WeakMap()
const MAX_UNKNOWN_PNPM_ERROR_CODES = 1_024
const PNPM_ERROR_CODE = /\bERR_PNPM_[A-Z0-9_]+\b/gu
const ANSI_CONTROL_SEQUENCE = /\u001B\[[0-?]*[ -/]*[@-~]/gu
const UNSAFE_OUTPUT_CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/u
const NON_TRANSIENT = /(?:\bERR_PNPM_(?:BROKEN_LOCKFILE|LOCKFILE|OUTDATED_LOCKFILE|TARBALL_INTEGRITY|UNEXPECTED_PKG_CONTENT_IN_STORE|BAD_TARBALL|INVALID_WORKSPACE_CONFIGURATION|CONFIG|PEER_DEP_ISSUES|MISMATCHED_RELEASE_CHANNEL|NO_OFFLINE_TARBALL|NO_MATCHING_VERSION_INSIDE_WORKSPACE|UNSUPPORTED_ENGINE)\b|(?:frozen[- ]lockfile|lockfile|integrity|checksum|signature|supply[- ]chain|minimum release age|trust polic(?:y)?)[^\r\n]{0,160}\b(?:fail(?:ed|ure)?|invalid|outdated|broken|missing|mismatch(?:ed)?|not[- ]met|violation|reject(?:ed|ion)?|unsupported)\b|(?:configuration|config)\s+error(?=$|\s|:)|(?:unknown|invalid|unsupported) option)/iu
const TRANSIENT_NETWORK = /(?:EAI_AGAIN|ETIMEDOUT|ECONNRESET|ERR_SOCKET_CONNECTION_TIMEOUT|socket hang up|request timed out|temporary failure in name resolution)/iu
// Observed terminal output from the pinned pnpm 11.7.0 request timeout.
// This is a network failure, not evidence that our process watchdog fired.
const PNPM_NATIVE_REQUEST_TIMEOUT = /^(?:\[23\]|TimeoutError:) The operation was aborted due to timeout\s*$/u
const RATE_LIMIT = /(?:HTTP(?:\s+status)?|status(?:\s+code)?|response)\s*[:=]?\s*429\b|\b429\s+(?:Too Many Requests|rate limit(?:ed|ing)?)/iu
const SERVER_ERROR = /(?:HTTP(?:\s+status)?|status(?:\s+code)?|response)\s*[:=]?\s*5\d\d\b|\b5\d\d\s+(?:Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout)\b/iu
const HTTP_STATUS = /(?:(?:HTTP(?:\s+status)?|status(?:\s+code)?|response)\s*[:=]?\s*([45]\d\d)\b|\b([45]\d\d)\s+(?:Bad Request|Unauthorized|Forbidden|Not Found|Request Timeout|Conflict|Gone|Unprocessable Content|Too Many Requests|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout)\b)/giu
const TERMINAL_ERROR = /(?:\bERR_PNPM_[A-Z0-9_]+\b|(?:^|\s)(?:ERROR|ERR!|FATAL)(?=$|\s|:)|(?:request|fetch|network|connection) failed|failed to (?:fetch|resolve|download))/iu
const WARNING = /(?:^|\s)(?:WARN|WARNING)(?:\s|$|:)/iu

export const PNPM_PRODUCER_FETCH_POLICY = Object.freeze({
  schemaVersion: 4,
  packageManager: 'pnpm@11.7.0',
  policy: 'pnpm-producer-bounded-fetch-retry-v8-native-timeout-readonly',
  rootContractDigest: WORKER_BUILD_ROOT_CONTRACT_DIGEST,
  trustedPnpmVersion: '11.7.0',
  trustedPnpmExecutablePolicy: 'absolute-corepack-shim-canonical-target-root-owned-read-only',
  corepackPolicy: 'fixed-build-time-home-network-disabled',
  maxAttempts: 2,
  perAttemptTimeoutMs: 475_000,
  killGraceMs: 5_000,
  terminalObservationSlackMs: 5_000,
  backoffMs: 15_000,
  totalBudgetMs: 990_000,
  producerMinimumReleaseAgeMinutes: 1_440,
  networkPolicy: 'producer-network-only-consumers-network-none',
  userStoreDependency: false,
  timeoutAuthority: 'wrapper-monotonic-watchdog',
})

function hasExactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0')
}

function isSafeElapsed(value, maximum = PNPM_PRODUCER_FETCH_POLICY.totalBudgetMs) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum
}

function maximumAttemptElapsedMs(policy = PNPM_PRODUCER_FETCH_POLICY) {
  return policy.perAttemptTimeoutMs + policy.killGraceMs + policy.terminalObservationSlackMs
}

function assertPnpmProducerFetchBudget(policy = PNPM_PRODUCER_FETCH_POLICY) {
  const worstCaseAttempts = policy.maxAttempts * maximumAttemptElapsedMs(policy)
    + (policy.maxAttempts - 1) * policy.backoffMs
  if (!Number.isSafeInteger(worstCaseAttempts) || worstCaseAttempts > policy.totalBudgetMs) {
    throw new Error('pnpm Producer fetch retry policy exceeds its locked total budget')
  }
}

assertPnpmProducerFetchBudget()

function runnerValidationError(reasonCode) {
  const safeReason = PNPM_PRODUCER_FETCH_RUNNER_VALIDATION_REASON_CODES.includes(reasonCode)
    ? reasonCode
    : 'OTHER_RUNNER_VALIDATION'
  const error = new Error(`pnpm Producer fetch runner validation failed closed: ${safeReason}`)
  Object.defineProperty(error, 'code', {
    value: 'ERR_PNPM_PRODUCER_FETCH_RUNNER_VALIDATION', enumerable: false,
  })
  Object.defineProperty(error, 'reasonCode', { value: safeReason, enumerable: false })
  RUNNER_VALIDATION_ERROR_REASONS.set(error, safeReason)
  return error
}

function runnerValidationReason(error) {
  if ((typeof error !== 'object' && typeof error !== 'function') || error === null) {
    return 'OTHER_RUNNER_VALIDATION'
  }
  try { return RUNNER_VALIDATION_ERROR_REASONS.get(error) ?? 'OTHER_RUNNER_VALIDATION' } catch {
    return 'OTHER_RUNNER_VALIDATION'
  }
}

function isWithin(root, candidate) {
  const path = relative(root, candidate)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

function freezeAttempt(value) {
  return Object.freeze(Object.fromEntries(ATTEMPT_KEYS.map(key => [key, value[key]])))
}

export function PNPM_PRODUCER_FETCH_COMMAND_ARGS(storeRoot = STORE_ROOT) {
  if (storeRoot !== STORE_ROOT) throw new Error('pnpm Producer Store root does not match the locked Worker root contract')
  return Object.freeze([
    `--store-dir=${STORE_ROOT}`,
    '--package-import-method=copy',
    '--config.enable-global-virtual-store=false',
    'fetch', '--frozen-lockfile', '--ignore-scripts',
  ])
}

export function createPnpmProducerFetchEnvironment(source = process.env) {
  if (source === null || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error('pnpm Producer environment source must be an object')
  }
  if (source[SOURCE_ROOT_VARIABLE] !== SOURCE_ROOT || source[STORE_ROOT_VARIABLE] !== STORE_ROOT) {
    throw new Error('pnpm Producer environment does not match the locked Worker root contract')
  }
  if (source.COREPACK_HOME !== PNPM_PRODUCER_COREPACK_HOME) {
    throw new Error('pnpm Producer COREPACK_HOME does not match the fixed build-time contract')
  }
  return Object.freeze({
    PATH: FIXED_PATH,
    HOME: '/tmp/paimind-pnpm-producer-home',
    TMPDIR: '/tmp',
    CI: 'true',
    NO_COLOR: '1',
    COREPACK_HOME: PNPM_PRODUCER_COREPACK_HOME,
    COREPACK_ENABLE_NETWORK: '0',
    pnpm_config_cache_dir: `${STORE_ROOT}/.cache/pnpm`,
    [SOURCE_ROOT_VARIABLE]: SOURCE_ROOT,
    [STORE_ROOT_VARIABLE]: STORE_ROOT,
  })
}

export function isTrustedPnpmProducerTarget(metadata) {
  return metadata !== null && typeof metadata === 'object'
    && typeof metadata.isFile === 'function' && metadata.isFile()
    && typeof metadata.isSymbolicLink === 'function' && !metadata.isSymbolicLink()
    && metadata.uid === 0 && metadata.gid === 0 && metadata.nlink === 1
    && Number.isInteger(metadata.mode) && (metadata.mode & 0o222) === 0
    && (metadata.mode & 0o111) !== 0
}

export async function verifyTrustedPnpmProducerExecutable(path = PNPM_PRODUCER_EXECUTABLE) {
  if (path !== PNPM_PRODUCER_EXECUTABLE) throw new Error('pnpm Producer executable does not match the locked absolute entry')
  let entry
  try { entry = await lstat(path) } catch { throw new Error('trusted pnpm Producer executable is missing') }
  if (!entry.isSymbolicLink() || entry.uid !== 0) throw new Error('trusted pnpm Producer entry must be the root-owned locked Corepack symbolic link')
  let canonical
  try { canonical = await realpath(path) } catch { throw new Error('trusted pnpm Producer executable target is missing') }
  if (!isWithin(TRUSTED_COREPACK_ROOT, canonical)) throw new Error('trusted pnpm Producer executable target escapes Corepack')
  const target = await lstat(canonical)
  if (!isTrustedPnpmProducerTarget(target)) {
    throw new Error('trusted pnpm Producer executable target is not root-owned and read-only')
  }
  return Object.freeze({ status: 'PASS', policy: PNPM_PRODUCER_FETCH_POLICY.trustedPnpmExecutablePolicy })
}

function transientClassifications(text) {
  const values = []
  if (TRANSIENT_NETWORK.test(text) || PNPM_NATIVE_REQUEST_TIMEOUT.test(text)) values.push('network')
  if (RATE_LIMIT.test(text)) values.push('rate-limit')
  if (SERVER_ERROR.test(text)) values.push('server-error')
  return values
}

function strictHttpStatusCodes(text) {
  return [...text.matchAll(HTTP_STATUS)].map(match => Number(match[1] ?? match[2]))
}

function hasOrdinaryClientFailure(statusCodes) {
  return statusCodes.some(code => code >= 400 && code < 500 && code !== 429)
}

export function createPnpmFetchOutputClassifier() {
  const decoder = new TextDecoder('utf-8', { fatal: false })
  const allowlistedPnpmErrorCodes = new Set()
  const httpStatusCodes = new Set()
  const reasonCodes = new Set()
  let unknownPnpmErrorCodeCount = 0
  let unknownPnpmErrorCodeOverflow = false
  let pending = ''
  let observedNonTransient = false
  let observedTransient = false
  let terminalClassification = null
  const observedTransientClassifications = new Set()
  let outputBytes = 0
  let finished = false
  let finalEvidence

  function inspect(rawText, completeLine) {
    if (rawText.length === 0) return
    const unsafeControl = UNSAFE_OUTPUT_CONTROL.test(rawText)
    const text = rawText.replace(ANSI_CONTROL_SEQUENCE, '')
    const transients = transientClassifications(text)
    const transient = transients.length === 1 ? transients[0] : null
    for (const classification of transients) observedTransientClassifications.add(classification)
    const codes = [...text.matchAll(PNPM_ERROR_CODE)].map(match => match[0])
    const strictStatuses = strictHttpStatusCodes(text)
    for (const code of codes) {
      if (DIAGNOSTIC_PNPM_ERROR_CODE_SET.has(code)) allowlistedPnpmErrorCodes.add(code)
      else if (unknownPnpmErrorCodeCount < MAX_UNKNOWN_PNPM_ERROR_CODES) unknownPnpmErrorCodeCount += 1
      else unknownPnpmErrorCodeOverflow = true
    }
    const policyOrContract = NON_TRANSIENT.test(text)
    const ordinaryClient = hasOrdinaryClientFailure(strictStatuses)
    const unknownPnpm = codes.some(code => !DIAGNOSTIC_PNPM_ERROR_CODE_SET.has(code))
    const genericNonTransient = !WARNING.test(text) && TERMINAL_ERROR.test(text) && transient === null
    const transientAmbiguity = transients.length > 1
    const nonTransient = unsafeControl || policyOrContract || ordinaryClient || unknownPnpm
      || genericNonTransient || transientAmbiguity
    if (unsafeControl) reasonCodes.add('CONTROL_SEQUENCE')
    if (policyOrContract) reasonCodes.add('POLICY_OR_LOCKFILE')
    if (ordinaryClient) reasonCodes.add('HTTP_CLIENT_4XX')
    if (unknownPnpm) reasonCodes.add('UNKNOWN_PNPM_CODE')
    if (genericNonTransient) reasonCodes.add('GENERIC_TERMINAL')
    if (transientAmbiguity) reasonCodes.add('TRANSIENT_CLASS_AMBIGUITY')
    if (ordinaryClient || transient === 'rate-limit' || transient === 'server-error') {
      for (const code of strictStatuses) if (httpStatusCodes.size < 16) httpStatusCodes.add(code)
    }
    if (nonTransient) observedNonTransient = true
    if (transients.length > 0) observedTransient = true
    if (!completeLine || WARNING.test(text)) return
    if (nonTransient || (TERMINAL_ERROR.test(text) && transient === null)) {
      terminalClassification = null
      observedNonTransient = true
    } else if (transient !== null && (TERMINAL_ERROR.test(text) || PNPM_NATIVE_REQUEST_TIMEOUT.test(text))) {
      terminalClassification = transient
    }
  }

  function push(value) {
    if (finished) throw new Error('pnpm Producer output classifier is already finalized')
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value)
    outputBytes += bytes.byteLength
    if (!Number.isSafeInteger(outputBytes)) throw new Error('pnpm Producer output exceeded its safe accounting range')
    pending += decoder.decode(bytes, { stream: true })
    let newline
    while ((newline = pending.indexOf('\n')) !== -1) {
      inspect(pending.slice(0, newline).replace(/\r$/u, ''), true)
      pending = pending.slice(newline + 1)
    }
    while (pending.length > 65_536) {
      inspect(pending.slice(0, 61_440), false)
      pending = pending.slice(60_416)
    }
  }

  function finish() {
    if (finished) return finalEvidence
    pending += decoder.decode()
    inspect(pending.replace(/\r$/u, ''), true)
    pending = ''
    finished = true
    const transientValues = [...observedTransientClassifications].sort()
    if (transientValues.length > 1) {
      observedNonTransient = true
      reasonCodes.add('TRANSIENT_CLASS_AMBIGUITY')
    }
    if (observedNonTransient) terminalClassification = null
    if (observedTransient && observedNonTransient) reasonCodes.add('MIXED_EVIDENCE')
    finalEvidence = Object.freeze({
      terminalClassification,
      transientClassifications: Object.freeze(transientValues),
      observedNonTransient,
      observedTransient,
      reasonCodes: Object.freeze([...reasonCodes].sort()),
      allowlistedPnpmErrorCodes: Object.freeze([...allowlistedPnpmErrorCodes].sort()),
      unknownPnpmErrorCodeCount,
      unknownPnpmErrorCodeOverflow,
      httpStatusCodes: Object.freeze([...httpStatusCodes].sort((left, right) => left - right)),
      outputBytes,
    })
    return finalEvidence
  }
  return Object.freeze({ push, finish })
}

function mergePnpmFetchOutputEvidence(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('pnpm Producer fetch output evidence streams are invalid')
  }
  const reasonCodes = new Set()
  const allowlistedPnpmErrorCodes = new Set()
  const httpStatusCodes = new Set()
  let observedNonTransient = false
  let observedTransient = false
  let unknownPnpmErrorCodeCount = 0
  let unknownPnpmErrorCodeOverflow = false
  let outputBytes = 0
  const terminalClassifications = new Set()
  const transientClassifications = new Set()
  for (const value of values) {
    observedNonTransient ||= value.observedNonTransient
    observedTransient ||= value.observedTransient
    for (const reason of value.reasonCodes) reasonCodes.add(reason)
    for (const code of value.allowlistedPnpmErrorCodes) allowlistedPnpmErrorCodes.add(code)
    for (const status of value.httpStatusCodes) httpStatusCodes.add(status)
    if (value.terminalClassification !== null) terminalClassifications.add(value.terminalClassification)
    for (const classification of value.transientClassifications) transientClassifications.add(classification)
    const remainingUnknownCapacity = MAX_UNKNOWN_PNPM_ERROR_CODES - unknownPnpmErrorCodeCount
    if (value.unknownPnpmErrorCodeCount > remainingUnknownCapacity) unknownPnpmErrorCodeOverflow = true
    unknownPnpmErrorCodeCount += Math.min(value.unknownPnpmErrorCodeCount, remainingUnknownCapacity)
    unknownPnpmErrorCodeOverflow ||= value.unknownPnpmErrorCodeOverflow
    outputBytes += value.outputBytes
    if (!Number.isSafeInteger(outputBytes)) throw new Error('pnpm Producer output exceeded its safe accounting range')
  }
  if (transientClassifications.size > 1) {
    observedNonTransient = true
    reasonCodes.add('TRANSIENT_CLASS_AMBIGUITY')
  }
  if (observedTransient && observedNonTransient) reasonCodes.add('MIXED_EVIDENCE')
  const terminalClassification = !observedNonTransient
    && transientClassifications.size === 1 && terminalClassifications.size === 1
    ? [...terminalClassifications][0]
    : null
  return Object.freeze({
    terminalClassification,
    transientClassifications: Object.freeze([...transientClassifications].sort()),
    observedNonTransient,
    observedTransient,
    reasonCodes: Object.freeze([...reasonCodes].sort()),
    allowlistedPnpmErrorCodes: Object.freeze([...allowlistedPnpmErrorCodes].sort()),
    unknownPnpmErrorCodeCount,
    unknownPnpmErrorCodeOverflow,
    httpStatusCodes: Object.freeze([...httpStatusCodes].sort((left, right) => left - right).slice(0, 16)),
    outputBytes,
  })
}

function requireEvidence(value) {
  if (!hasExactKeys(value, EVIDENCE_KEYS)
    || !(value.terminalClassification === null || OUTPUT_TRANSIENT_CLASSIFICATIONS.includes(value.terminalClassification))
    || !Array.isArray(value.transientClassifications)
    || value.transientClassifications.some(classification => !OUTPUT_TRANSIENT_CLASSIFICATIONS.includes(classification))
    || JSON.stringify(value.transientClassifications) !== JSON.stringify([...new Set(value.transientClassifications)].sort())
    || typeof value.observedNonTransient !== 'boolean' || typeof value.observedTransient !== 'boolean'
    || !Array.isArray(value.reasonCodes) || value.reasonCodes.length > DIAGNOSTIC_REASON_CODES.length
    || value.reasonCodes.some(reason => !DIAGNOSTIC_REASON_CODES.includes(reason))
    || JSON.stringify(value.reasonCodes) !== JSON.stringify([...new Set(value.reasonCodes)].sort())
    || !Array.isArray(value.allowlistedPnpmErrorCodes)
    || value.allowlistedPnpmErrorCodes.some(code => !DIAGNOSTIC_PNPM_ERROR_CODE_SET.has(code))
    || JSON.stringify(value.allowlistedPnpmErrorCodes) !== JSON.stringify([...new Set(value.allowlistedPnpmErrorCodes)].sort())
    || !Number.isSafeInteger(value.unknownPnpmErrorCodeCount)
    || value.unknownPnpmErrorCodeCount < 0 || value.unknownPnpmErrorCodeCount > MAX_UNKNOWN_PNPM_ERROR_CODES
    || typeof value.unknownPnpmErrorCodeOverflow !== 'boolean'
    || !Array.isArray(value.httpStatusCodes) || value.httpStatusCodes.length > 16
    || value.httpStatusCodes.some(code => !Number.isSafeInteger(code) || code < 400 || code > 599)
    || JSON.stringify(value.httpStatusCodes) !== JSON.stringify([...new Set(value.httpStatusCodes)].sort((left, right) => left - right))
    || !Number.isSafeInteger(value.outputBytes) || value.outputBytes < 0
    || ((value.unknownPnpmErrorCodeCount > 0 || value.unknownPnpmErrorCodeOverflow) !== value.reasonCodes.includes('UNKNOWN_PNPM_CODE'))
    || (value.observedTransient !== (value.transientClassifications.length > 0))
    || (value.reasonCodes.includes('TRANSIENT_CLASS_AMBIGUITY') !== (value.transientClassifications.length > 1))
    || (value.observedNonTransient !== (value.reasonCodes.length > 0))
    || (value.reasonCodes.includes('HTTP_CLIENT_4XX') !== hasOrdinaryClientFailure(value.httpStatusCodes))
    || (value.reasonCodes.includes('MIXED_EVIDENCE') !== (value.observedTransient && value.observedNonTransient))
    || (value.reasonCodes.includes('MIXED_EVIDENCE') && value.reasonCodes.length < 2)
    || (value.terminalClassification !== null
      && (!value.observedTransient || value.observedNonTransient
        || !value.transientClassifications.includes(value.terminalClassification)))) {
    throw new Error('pnpm Producer fetch runner returned invalid output evidence')
  }
  return Object.freeze({
    ...Object.fromEntries(EVIDENCE_KEYS.map(key => [key, value[key]])),
    transientClassifications: Object.freeze([...value.transientClassifications]),
    reasonCodes: Object.freeze([...value.reasonCodes]),
    allowlistedPnpmErrorCodes: Object.freeze([...value.allowlistedPnpmErrorCodes]),
    httpStatusCodes: Object.freeze([...value.httpStatusCodes]),
  })
}

function legacyEvidence(value) {
  const stdoutClassifier = createPnpmFetchOutputClassifier()
  const stderrClassifier = createPnpmFetchOutputClassifier()
  stdoutClassifier.push(value.stdout)
  stderrClassifier.push(value.stderr)
  return mergePnpmFetchOutputEvidence([stdoutClassifier.finish(), stderrClassifier.finish()])
}

function hasCoherentTerminalState(value) {
  const exited = value.exitCode !== null
  const signaled = value.signal !== null
  if (exited === signaled) return false
  if (value.timedOut && value.interrupted) return false
  if (value.timedOut || value.interrupted) {
    return signaled && (value.signal === 'SIGTERM' || value.signal === 'SIGKILL')
  }
  return true
}

function requireAttemptResult(
  value,
  maximumElapsedMs = maximumAttemptElapsedMs(),
  operationTimeoutMs = PNPM_PRODUCER_FETCH_POLICY.perAttemptTimeoutMs,
) {
  if (!isSafeElapsed(maximumElapsedMs)
    || !Number.isSafeInteger(operationTimeoutMs) || operationTimeoutMs < 1
    || operationTimeoutMs > maximumElapsedMs) throw runnerValidationError('RUNNER_SPEC_INVALID')
  const legacy = hasExactKeys(value, LEGACY_RESULT_KEYS)
  const safe = hasExactKeys(value, SAFE_RESULT_KEYS)
  if (!legacy && !safe) throw runnerValidationError('RESULT_SHAPE_INVALID')
  let result
  try {
    result = safe ? value : {
      exitCode: value.exitCode, signal: value.signal, timedOut: value.timedOut,
      timeoutAuthority: value.timedOut ? null : PNPM_PRODUCER_FETCH_POLICY.timeoutAuthority,
      interrupted: false, elapsedMs: value.elapsedMs, stdoutExactMatch: null,
      evidence: legacyEvidence(value),
    }
  } catch { throw runnerValidationError('EVIDENCE_SCHEMA_INVALID') }
  if (!(result.exitCode === null || (Number.isSafeInteger(result.exitCode) && result.exitCode >= 0 && result.exitCode <= 255))
    || !(result.signal === null || (typeof result.signal === 'string' && /^SIG[A-Z0-9]+$/u.test(result.signal)))
    || typeof result.timedOut !== 'boolean' || typeof result.interrupted !== 'boolean'
    || !(result.stdoutExactMatch === null || typeof result.stdoutExactMatch === 'boolean')) {
    throw runnerValidationError('RESULT_SHAPE_INVALID')
  }
  if (!isSafeElapsed(result.elapsedMs, maximumElapsedMs)) {
    throw runnerValidationError('ELAPSED_BOUND_EXCEEDED')
  }
  if (!result.timedOut && !result.interrupted && result.elapsedMs > operationTimeoutMs) {
    throw runnerValidationError('OPERATION_DEADLINE_EXCEEDED')
  }
  if (result.timeoutAuthority !== PNPM_PRODUCER_FETCH_POLICY.timeoutAuthority
    || !hasCoherentTerminalState(result) || (legacy && result.timedOut)) {
    throw runnerValidationError('TERMINAL_TUPLE_INVALID')
  }
  let checkedEvidence
  try { checkedEvidence = requireEvidence(result.evidence) } catch {
    throw runnerValidationError('EVIDENCE_SCHEMA_INVALID')
  }
  return Object.freeze({ ...result, evidence: checkedEvidence })
}

function classifyResult(result) {
  if (result.exitCode === 0 && result.signal === null && !result.timedOut) return null
  if (result.interrupted || (result.signal !== null && !result.timedOut)) return null
  if (result.evidence.observedNonTransient) {
    const evidence = result.evidence
    const boundedGenericNetworkRetry = !result.interrupted
      && ((!result.timedOut && result.signal === null)
        || (result.timedOut && (result.signal === 'SIGTERM' || result.signal === 'SIGKILL')))
      && JSON.stringify(evidence.transientClassifications) === JSON.stringify(['network'])
      && JSON.stringify(evidence.reasonCodes) === JSON.stringify(['GENERIC_TERMINAL', 'MIXED_EVIDENCE'])
      && evidence.allowlistedPnpmErrorCodes.length === 0
      && evidence.unknownPnpmErrorCodeCount === 0 && evidence.unknownPnpmErrorCodeOverflow === false
      && evidence.httpStatusCodes.length === 0
    return boundedGenericNetworkRetry ? (result.timedOut ? 'timeout' : 'network') : null
  }
  if (result.timedOut) return 'timeout'
  return result.evidence.terminalClassification
}

export function isTransientPnpmFetchFailure(value) {
  return classifyResult(requireAttemptResult(value)) !== null
}

function requireAttemptReceipt(value, expectedAttempt, expectedStatus) {
  const classificationAllowed = value?.classification === 'none' || TRANSIENT_CLASSIFICATIONS.includes(value?.classification)
  const unsuccessful = value?.exitCode !== 0 || value?.signal !== null || value?.timedOut
  if (!hasExactKeys(value, ATTEMPT_KEYS) || value.attempt !== expectedAttempt || value.status !== expectedStatus
    || !classificationAllowed
    || !(value.exitCode === null || (Number.isSafeInteger(value.exitCode) && value.exitCode >= 0 && value.exitCode <= 255))
    || !(value.signal === null || (typeof value.signal === 'string' && /^SIG[A-Z0-9]+$/u.test(value.signal)))
    || typeof value.timedOut !== 'boolean'
    || !hasCoherentTerminalState({ ...value, interrupted: false })
    || !isSafeElapsed(value.elapsedMs, maximumAttemptElapsedMs())
    || (expectedStatus === 'PASS' && (value.classification !== 'none' || value.exitCode !== 0 || value.signal !== null || value.timedOut))
    || (expectedStatus === 'TRANSIENT_FAILURE' && (!unsuccessful || !TRANSIENT_CLASSIFICATIONS.includes(value.classification)
      || (value.signal !== null && !value.timedOut)))
    || ((value.classification === 'timeout') !== value.timedOut)) {
    throw new Error('pnpm Producer fetch receipt contains an invalid attempt')
  }
  return freezeAttempt(value)
}

export function requirePnpmProducerFetchReceipt(value, label = 'pnpm Producer fetch receipt') {
  const policy = PNPM_PRODUCER_FETCH_POLICY
  if (!hasExactKeys(value, RECEIPT_KEYS) || value.schemaVersion !== policy.schemaVersion || value.status !== 'PASS'
    || value.packageManager !== policy.packageManager || value.policy !== policy.policy
    || value.rootContractDigest !== policy.rootContractDigest || value.trustedPnpmVersion !== policy.trustedPnpmVersion
    || value.trustedPnpmExecutablePolicy !== policy.trustedPnpmExecutablePolicy
    || value.corepackPolicy !== policy.corepackPolicy || value.maxAttempts !== policy.maxAttempts
    || value.perAttemptTimeoutMs !== policy.perAttemptTimeoutMs || value.killGraceMs !== policy.killGraceMs
    || value.terminalObservationSlackMs !== policy.terminalObservationSlackMs
    || value.backoffMs !== policy.backoffMs || value.totalBudgetMs !== policy.totalBudgetMs
    || value.producerMinimumReleaseAgeMinutes !== policy.producerMinimumReleaseAgeMinutes
    || value.networkPolicy !== policy.networkPolicy || value.userStoreDependency !== false
    || value.timeoutAuthority !== policy.timeoutAuthority
    || !Number.isSafeInteger(value.attemptsUsed) || value.attemptsUsed < 1 || value.attemptsUsed > policy.maxAttempts
    || !Number.isSafeInteger(value.transientFailures) || value.transientFailures !== value.attemptsUsed - 1
    || !isSafeElapsed(value.totalElapsedMs) || !Array.isArray(value.attempts)
    || value.attempts.length !== value.attemptsUsed) {
    throw new Error(`${label} does not match the locked pnpm Producer fetch contract`)
  }
  const attempts = value.attempts.map((attempt, index) => requireAttemptReceipt(
    attempt, index + 1, index === value.attempts.length - 1 ? 'PASS' : 'TRANSIENT_FAILURE',
  ))
  const minimum = attempts.reduce((total, attempt) => total + attempt.elapsedMs, 0)
    + policy.backoffMs * value.transientFailures
  if (value.totalElapsedMs < minimum) throw new Error(`${label} does not match the locked pnpm Producer fetch contract`)
  return Object.freeze({
    ...Object.fromEntries(RECEIPT_KEYS.filter(key => key !== 'attempts').map(key => [key, value[key]])),
    attempts: Object.freeze(attempts),
  })
}

function sameIdentity(left, right) { return left.dev === right.dev && left.ino === right.ino }

async function removeCreatedReceipt(path, identity) {
  try {
    const current = await lstat(path, { bigint: true })
    if (sameIdentity(current, identity)) await unlink(path)
  } catch (error) { if (error?.code !== 'ENOENT') throw error }
}

function throwIfReceiptCommitAborted(signal) {
  if (signal?.aborted) throw new Error('pnpm Producer fetch receipt commit was aborted')
}

export async function writePnpmProducerFetchReceipt(path, value, options = {}) {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) {
    throw new Error('pnpm Producer fetch receipt path must be absolute')
  }
  if (options === null || typeof options !== 'object' || Array.isArray(options)
    || (options.signal !== undefined && typeof options.signal?.aborted !== 'boolean')
    || (options.afterOpen !== undefined && typeof options.afterOpen !== 'function')
    || (options.afterWrite !== undefined && typeof options.afterWrite !== 'function')) {
    throw new Error('pnpm Producer fetch receipt writer options are invalid')
  }
  const signal = options.signal
  throwIfReceiptCommitAborted(signal)
  const receipt = requirePnpmProducerFetchReceipt(value)
  const bytes = Buffer.from(`${JSON.stringify(receipt)}\n`, 'utf8')
  let handle
  let createdIdentity
  try {
    handle = await open(path, fsConstants.O_RDWR | fsConstants.O_CREAT | fsConstants.O_EXCL | NO_FOLLOW, 0o600)
    createdIdentity = await handle.stat({ bigint: true })
    if (!createdIdentity.isFile() || createdIdentity.isSymbolicLink() || createdIdentity.nlink !== 1n
      || (createdIdentity.mode & 0o777n) !== 0o600n) throw new Error('pnpm Producer fetch receipt must be one private regular file')
    await options.afterOpen?.(Object.freeze({ path, signal }))
    throwIfReceiptCommitAborted(signal)
    await handle.writeFile(bytes, signal === undefined ? undefined : { signal })
    throwIfReceiptCommitAborted(signal)
    await handle.sync()
    throwIfReceiptCommitAborted(signal)
    await options.afterWrite?.(Object.freeze({ path, signal }))
    throwIfReceiptCommitAborted(signal)
    const readback = Buffer.alloc(bytes.byteLength)
    const read = await handle.read(readback, 0, readback.byteLength, 0)
    throwIfReceiptCommitAborted(signal)
    const after = await handle.stat({ bigint: true })
    const pathAfter = await lstat(path, { bigint: true })
    if (!after.isFile() || after.nlink !== 1n || (after.mode & 0o777n) !== 0o600n
      || read.bytesRead !== bytes.byteLength || !readback.equals(bytes)
      || BigInt(bytes.byteLength) !== after.size || !sameIdentity(createdIdentity, after)
      || !sameIdentity(after, pathAfter) || pathAfter.nlink !== 1n) {
      throw new Error('pnpm Producer fetch receipt changed while being committed')
    }
    throwIfReceiptCommitAborted(signal)
    return receipt
  } catch (error) {
    if (createdIdentity !== undefined) {
      try { await handle?.truncate(0); await handle?.sync() } catch {}
      await removeCreatedReceipt(path, createdIdentity)
    }
    if (error?.code === 'ELOOP' || error?.code === 'EEXIST') throw new Error('pnpm Producer fetch receipt path already exists or is a symbolic link')
    throw error
  } finally { await handle?.close() }
}

function defaultKillGroup(pid, signal) {
  if (!Number.isSafeInteger(pid) || pid < 1) return
  try { process.kill(-pid, signal) } catch (error) { if (error?.code !== 'ESRCH') throw error }
}

export function createPnpmProducerFetchRunner(dependencies = {}) {
  const spawnImpl = dependencies.spawn ?? spawn
  const now = dependencies.now ?? (() => performance.now())
  const setTimer = dependencies.setTimer ?? setTimeout
  const clearTimer = dependencies.clearTimer ?? clearTimeout
  const killGroup = dependencies.killProcessGroup ?? defaultKillGroup
  if ([spawnImpl, now, setTimer, clearTimer, killGroup].some(value => typeof value !== 'function')) {
    throw new Error('pnpm Producer runner dependencies must be functions')
  }
  return spec => new Promise((resolvePromise, rejectPromise) => {
    const started = now()
    if (spec === null || typeof spec !== 'object' || Array.isArray(spec)
      || !RUNNER_PURPOSES.includes(spec.purpose)
      || !Number.isSafeInteger(spec.timeoutMs) || spec.timeoutMs < 1
      || spec.timeoutMs > PNPM_PRODUCER_FETCH_POLICY.perAttemptTimeoutMs
      || spec.killGraceMs !== PNPM_PRODUCER_FETCH_POLICY.killGraceMs
      || spec.terminalObservationSlackMs !== PNPM_PRODUCER_FETCH_POLICY.terminalObservationSlackMs
      || typeof spec.signal?.aborted !== 'boolean') {
      rejectPromise(runnerValidationError('RUNNER_SPEC_INVALID'))
      return
    }
    const maximumElapsedMs = spec.timeoutMs + spec.killGraceMs + spec.terminalObservationSlackMs
    const operationDeadline = started + spec.timeoutMs
    const timeoutKillDeadline = operationDeadline + spec.killGraceMs
    const timeoutObservationDeadline = timeoutKillDeadline + spec.terminalObservationSlackMs
    const stdoutClassifier = createPnpmFetchOutputClassifier()
    const stderrClassifier = createPnpmFetchOutputClassifier()
    const exactChunks = []
    let exactBytes = 0
    let timedOut = false
    let interrupted = false
    let closed = false
    let killSent = false
    let settled = false
    let code = null
    let closeSignal = null
    let deadlineViolated = false
    let activeKillDeadline = timeoutKillDeadline
    let activeObservationDeadline = timeoutObservationDeadline
    let watchdog
    let killTimer
    let observationTimer
    let child

    function cleanup() {
      if (watchdog !== undefined) clearTimer(watchdog)
      if (killTimer !== undefined) clearTimer(killTimer)
      if (observationTimer !== undefined) clearTimer(observationTimer)
      spec.signal?.removeEventListener('abort', onAbort)
    }
    function rejectValidation(reasonCode) {
      if (settled) return
      settled = true; cleanup(); rejectPromise(runnerValidationError(reasonCode))
    }
    function scheduleAt(deadline, assign, callback) {
      const tick = () => {
        if (settled) return
        const remaining = Math.ceil(deadline - now())
        if (remaining > 0) {
          assign(setTimer(tick, remaining))
          return
        }
        callback()
      }
      assign(setTimer(tick, Math.max(0, Math.ceil(deadline - now()))))
    }
    function finish() {
      if (settled || !closed || ((timedOut || interrupted) && !killSent)) return
      if (deadlineViolated) {
        rejectValidation('OPERATION_DEADLINE_EXCEEDED')
        return
      }
      settled = true; cleanup()
      const exact = spec.expectedStdout === undefined
        ? null
        : Buffer.concat(exactChunks).toString('utf8') === spec.expectedStdout
      try {
        resolvePromise(requireAttemptResult({
          exitCode: code, signal: closeSignal, timedOut,
          timeoutAuthority: PNPM_PRODUCER_FETCH_POLICY.timeoutAuthority,
          interrupted, elapsedMs: Math.max(0, Math.ceil(now() - started)),
          stdoutExactMatch: exact,
          evidence: mergePnpmFetchOutputEvidence([stdoutClassifier.finish(), stderrClassifier.finish()]),
        }, maximumElapsedMs, spec.timeoutMs))
      } catch (error) { rejectPromise(runnerValidationError(runnerValidationReason(error))) }
    }
    function terminate(reason) {
      if (timedOut || interrupted) return
      if (reason === 'timeout') timedOut = true
      else {
        interrupted = true
        const interruptedAt = now()
        activeKillDeadline = interruptedAt + spec.killGraceMs
        activeObservationDeadline = activeKillDeadline + spec.terminalObservationSlackMs
      }
      try { killGroup(child?.pid, 'SIGTERM') } catch { interrupted = true }
      scheduleAt(activeKillDeadline, value => { killTimer = value }, () => {
        try { killGroup(child?.pid, 'SIGKILL') } catch {}
        killSent = true
        finish()
      })
      scheduleAt(activeObservationDeadline, value => { observationTimer = value }, () => {
        rejectValidation('TERMINAL_OBSERVATION_DEADLINE')
      })
    }
    function onAbort() { terminate('interrupt') }
    try {
      child = spawnImpl(spec.command, spec.args, {
        cwd: spec.cwd, env: spec.environment, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
      })
      child.stdout.on('data', chunk => {
        stdoutClassifier.push(chunk)
        if (spec.expectedStdout !== undefined && exactBytes <= 128) {
          const bytes = Buffer.from(chunk); exactChunks.push(bytes); exactBytes += bytes.byteLength
        }
      })
      child.stderr.on('data', chunk => stderrClassifier.push(chunk))
      child.once('error', () => rejectValidation('SPAWN_ERROR_EVENT'))
      child.once('close', (exitCode, signal) => {
        closed = true; code = exitCode; closeSignal = signal
        if ((timedOut || interrupted) && now() >= activeObservationDeadline) {
          rejectValidation('TERMINAL_OBSERVATION_DEADLINE')
          return
        }
        if (!timedOut && !interrupted && now() >= operationDeadline) {
          deadlineViolated = true
          terminate('timeout')
        }
        finish()
      })
      spec.signal?.addEventListener('abort', onAbort, { once: true })
      if (spec.signal?.aborted) onAbort()
      scheduleAt(operationDeadline, value => { watchdog = value }, () => terminate('timeout'))
    } catch { rejectValidation('SPAWN_THROW') }
  })
}

function abortableDelay(ms, signal, setTimer, clearTimer) {
  return new Promise((resolvePromise, rejectPromise) => {
    let timer
    function onAbort() { if (timer !== undefined) clearTimer(timer); rejectPromise(new Error('interrupted')) }
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) return onAbort()
    timer = setTimer(() => { signal?.removeEventListener('abort', onAbort); resolvePromise() }, ms)
  })
}

function fixedError(code, message) {
  const error = new Error(message)
  Object.defineProperty(error, 'code', { value: code, enumerable: false })
  FIXED_ERROR_DETAILS.set(error, Object.freeze({ code, message }))
  return error
}

function safeDiagnosticDigest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`
}

export function requirePnpmProducerFetchRunnerValidationEvent(value) {
  if (!hasExactKeys(value, RUNNER_VALIDATION_EVENT_KEYS)
    || value.schemaVersion !== 1
    || value.event !== 'pnpm-producer-fetch-runner-validation'
    || !RUNNER_PURPOSES.includes(value.purpose)
    || !(value.attempt === null
      || (Number.isSafeInteger(value.attempt) && value.attempt >= 1
        && value.attempt <= PNPM_PRODUCER_FETCH_POLICY.maxAttempts))
    || (value.purpose === 'version-readback' && value.attempt !== null)
    || (value.purpose === 'producer-fetch' && value.attempt === null)
    || !PNPM_PRODUCER_FETCH_RUNNER_VALIDATION_REASON_CODES.includes(value.reasonCode)) {
    throw new Error('pnpm Producer fetch runner validation event is invalid')
  }
  const safeFacts = Object.freeze({
    purpose: value.purpose,
    attempt: value.attempt,
    reasonCode: value.reasonCode,
  })
  if (value.diagnosticDigest !== safeDiagnosticDigest(safeFacts)) {
    throw new Error('pnpm Producer fetch runner validation event digest is invalid')
  }
  return Object.freeze({ ...value })
}

function writeSummaryEvent(stream, value) {
  try { stream?.write(`${JSON.stringify(value)}\n`) } catch {}
}

function emitRunnerValidationSummary(stream, purpose, attempt, reasonCode) {
  const safeFacts = Object.freeze({ purpose, attempt, reasonCode })
  const event = requirePnpmProducerFetchRunnerValidationEvent({
    schemaVersion: 1,
    event: 'pnpm-producer-fetch-runner-validation',
    ...safeFacts,
    diagnosticDigest: safeDiagnosticDigest(safeFacts),
  })
  writeSummaryEvent(stream, event)
}

function emitSummary(stream, value, result) {
  writeSummaryEvent(stream, {
    schemaVersion: 1, event: 'pnpm-producer-fetch-attempt', attempt: value.attempt,
    status: value.status, classification: value.classification, elapsedMs: value.elapsedMs,
  })
  if (value.status === 'PASS') {
    if (result.evidence.observedNonTransient) {
      const safeFacts = Object.freeze({
        attempt: value.attempt,
        reasonCodes: result.evidence.reasonCodes,
        transientClassifications: result.evidence.transientClassifications,
      })
      writeSummaryEvent(stream, {
        schemaVersion: 1,
        event: 'pnpm-producer-fetch-advisory-success',
        ...safeFacts,
        diagnosticDigest: safeDiagnosticDigest(safeFacts),
      })
    }
    return
  }

  const evidence = result.evidence
  const reasonCodes = new Set(evidence.reasonCodes)
  if (value.timedOut) reasonCodes.add('WATCHDOG_TIMEOUT')
  if (value.signal !== null) reasonCodes.add('PROCESS_SIGNAL')
  if (value.classification === 'none' && reasonCodes.size === 0) reasonCodes.add('NO_TERMINAL_EVIDENCE')
  const safeFacts = Object.freeze({
    attempt: value.attempt,
    status: value.status,
    classification: value.classification,
    exitCode: value.exitCode,
    signal: value.signal === null
      ? null
      : (DIAGNOSTIC_SIGNALS.has(value.signal) ? value.signal : 'OTHER_SIGNAL'),
    timedOut: value.timedOut,
    outputBytes: evidence.outputBytes,
    observedTransient: evidence.observedTransient,
    observedNonTransient: evidence.observedNonTransient,
    transientClassifications: evidence.transientClassifications,
    reasonCodes: Object.freeze([...reasonCodes].sort()),
    pnpmErrorCodes: evidence.allowlistedPnpmErrorCodes,
    unknownPnpmErrorCodeCount: evidence.unknownPnpmErrorCodeCount,
    unknownPnpmErrorCodeOverflow: evidence.unknownPnpmErrorCodeOverflow,
    httpStatusCodes: evidence.httpStatusCodes,
  })
  writeSummaryEvent(stream, {
    schemaVersion: 1,
    event: 'pnpm-producer-fetch-diagnostic',
    ...safeFacts,
    elapsedMs: value.elapsedMs,
    diagnosticDigest: safeDiagnosticDigest(safeFacts),
  })
}

function runtimeClock(options) {
  const provided = options.clock
  const now = provided?.now ?? (() => performance.now())
  const setTimer = provided?.setTimer ?? setTimeout
  const clearTimer = provided?.clearTimer ?? clearTimeout
  const sleep = options.sleep ?? provided?.sleep ?? ((ms, signal) => abortableDelay(ms, signal, setTimer, clearTimer))
  if ([now, setTimer, clearTimer, sleep].some(value => typeof value !== 'function')) throw new Error('pnpm Producer fetch clock dependencies must be functions')
  return Object.freeze({ now, setTimer, clearTimer, sleep })
}

function createAttempt(attempt, result, status, classification) {
  return freezeAttempt({ attempt, status, classification, exitCode: result.exitCode,
    signal: result.signal, timedOut: result.timedOut, elapsedMs: result.elapsedMs })
}

export async function runPnpmOfflineStoreFetch(options = {}) {
  const policy = PNPM_PRODUCER_FETCH_POLICY
  if (options.storeRoot !== STORE_ROOT || (options.cwd ?? SOURCE_ROOT) !== SOURCE_ROOT) {
    throw new Error('pnpm Producer fetch roots do not match the locked Worker root contract')
  }
  if (typeof options.reportPath !== 'string' || !isAbsolute(options.reportPath)) throw new Error('pnpm Producer fetch requires an absolute receipt path')
  if ((options.writer !== undefined || options.receiptWriterHooks !== undefined) && options.installSignalHandlers !== false) {
    throw new Error('pnpm Producer fetch receipt test hooks require disabled process signal handlers')
  }
  const writer = options.writer ?? writePnpmProducerFetchReceipt
  const clock = runtimeClock(options)
  const runner = options.runner ?? createPnpmProducerFetchRunner({ now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer })
  const rootVerifier = options.verifyRoots ?? (environment => verifyWorkerBuildRootContract({ environment, requiredRoots: ['source', 'store'] }))
  const executableVerifier = options.verifyExecutable ?? verifyTrustedPnpmProducerExecutable
  if ([writer, runner, rootVerifier, executableVerifier].some(value => typeof value !== 'function')) throw new Error('pnpm Producer fetch runtime dependencies must be functions')
  const sourceEnvironment = options.environment ?? process.env
  const environment = createPnpmProducerFetchEnvironment(sourceEnvironment)
  let rootReceipt
  try { rootReceipt = await rootVerifier(sourceEnvironment) } catch {
    throw fixedError('ERR_PNPM_PRODUCER_FETCH_ROOTS', 'pnpm Producer root verification failed closed before network access')
  }
  if (rootReceipt?.status !== 'PASS' || rootReceipt?.contractDigest !== WORKER_BUILD_ROOT_CONTRACT_DIGEST
    || JSON.stringify(rootReceipt?.requiredRoots) !== JSON.stringify(['source', 'store'])
    || !Array.isArray(rootReceipt?.verifiedRoots) || rootReceipt.verifiedRoots.length !== 2
    || rootReceipt.verifiedRoots[0]?.root !== 'source' || rootReceipt.verifiedRoots[1]?.root !== 'store'
    || rootReceipt.verifiedRoots.some(root => root.ownerUid !== 0 || root.ownerGid !== 0 || root.mode !== 0o755)) {
    throw fixedError('ERR_PNPM_PRODUCER_FETCH_ROOTS', 'pnpm Producer root verification failed closed before network access')
  }
  let executableReceipt
  try { executableReceipt = await executableVerifier(PNPM_PRODUCER_EXECUTABLE) } catch {
    throw fixedError('ERR_PNPM_PRODUCER_FETCH_EXECUTABLE', 'pnpm Producer executable verification failed closed before network access')
  }
  if (executableReceipt?.status !== 'PASS' || executableReceipt?.policy !== policy.trustedPnpmExecutablePolicy) {
    throw fixedError('ERR_PNPM_PRODUCER_FETCH_EXECUTABLE', 'pnpm Producer executable verification failed closed before network access')
  }

  const attempts = []
  const args = PNPM_PRODUCER_FETCH_COMMAND_ARGS(STORE_ROOT)
  const summary = options.summary ?? process.stderr
  const started = clock.now()
  const deadline = started + policy.totalBudgetMs
  const terminationReserveMs = policy.killGraceMs + policy.terminalObservationSlackMs
  const terminateBy = deadline - terminationReserveMs
  const controller = new AbortController()
  let interruptSignal = null
  const handlers = new Map()
  for (const name of options.installSignalHandlers === false ? [] : ['SIGINT', 'SIGTERM']) {
    const handler = () => { interruptSignal = name; controller.abort() }
    handlers.set(name, handler); process.once(name, handler)
  }
  const globalTimer = clock.setTimer(() => controller.abort(), policy.totalBudgetMs - terminationReserveMs)
  try {
    const versionTimeoutMs = Math.min(30_000, Math.floor(terminateBy - clock.now()))
    let versionResult
    try {
      versionResult = requireAttemptResult(await runner(Object.freeze({
        purpose: 'version-readback', command: PNPM_PRODUCER_EXECUTABLE, args: ['--version'],
        cwd: SOURCE_ROOT, environment, timeoutMs: versionTimeoutMs,
        killGraceMs: policy.killGraceMs,
        terminalObservationSlackMs: policy.terminalObservationSlackMs,
        signal: controller.signal, expectedStdout: `${policy.trustedPnpmVersion}\n`,
      })), versionTimeoutMs + terminationReserveMs, versionTimeoutMs)
    } catch (error) {
      emitRunnerValidationSummary(summary, 'version-readback', null, runnerValidationReason(error))
      if (controller.signal.aborted) {
        throw fixedError(
          interruptSignal === null ? 'ERR_PNPM_PRODUCER_FETCH_DEADLINE' : 'ERR_PNPM_PRODUCER_FETCH_INTERRUPTED',
          interruptSignal === null
            ? 'pnpm Producer fetch reached its global deadline'
            : 'pnpm Producer fetch was interrupted after terminating its process group',
        )
      }
      throw fixedError('ERR_PNPM_PRODUCER_FETCH_VERSION', 'pnpm Producer version readback failed closed before network access')
    }
    if (versionResult.interrupted || controller.signal.aborted) {
      throw fixedError(
        interruptSignal === null ? 'ERR_PNPM_PRODUCER_FETCH_DEADLINE' : 'ERR_PNPM_PRODUCER_FETCH_INTERRUPTED',
        interruptSignal === null
          ? 'pnpm Producer fetch reached its global deadline'
          : 'pnpm Producer fetch was interrupted after terminating its process group',
      )
    }
    if (versionResult.exitCode !== 0 || versionResult.signal !== null || versionResult.timedOut
      || versionResult.stdoutExactMatch !== true
      || versionResult.evidence.observedNonTransient) {
      throw fixedError('ERR_PNPM_PRODUCER_FETCH_VERSION', 'pnpm Producer version readback did not match the locked package manager')
    }

    for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
      const remaining = Math.floor(terminateBy - clock.now())
      if (remaining <= 0 || controller.signal.aborted) throw fixedError('ERR_PNPM_PRODUCER_FETCH_DEADLINE', 'pnpm Producer fetch reached its global deadline')
      let result
      const attemptTimeoutMs = Math.min(policy.perAttemptTimeoutMs, remaining)
      try {
        result = requireAttemptResult(await runner(Object.freeze({
          purpose: 'producer-fetch', command: PNPM_PRODUCER_EXECUTABLE, args,
          cwd: SOURCE_ROOT, environment, timeoutMs: attemptTimeoutMs,
          killGraceMs: policy.killGraceMs,
          terminalObservationSlackMs: policy.terminalObservationSlackMs,
          signal: controller.signal,
        })), attemptTimeoutMs + terminationReserveMs, attemptTimeoutMs)
      } catch (error) {
        emitRunnerValidationSummary(summary, 'producer-fetch', attempt, runnerValidationReason(error))
        if (controller.signal.aborted) {
          throw fixedError(
            interruptSignal === null ? 'ERR_PNPM_PRODUCER_FETCH_DEADLINE' : 'ERR_PNPM_PRODUCER_FETCH_INTERRUPTED',
            interruptSignal === null
              ? 'pnpm Producer fetch reached its global deadline'
              : 'pnpm Producer fetch was interrupted after terminating its process group',
          )
        }
        throw fixedError('ERR_PNPM_PRODUCER_FETCH_RUNNER', 'pnpm Producer fetch runner failed closed')
      }
      if (result.interrupted || controller.signal.aborted) {
        throw fixedError(interruptSignal === null ? 'ERR_PNPM_PRODUCER_FETCH_DEADLINE' : 'ERR_PNPM_PRODUCER_FETCH_INTERRUPTED',
          interruptSignal === null ? 'pnpm Producer fetch reached its global deadline' : 'pnpm Producer fetch was interrupted after terminating its process group')
      }
      // The child is the already-verified absolute pnpm entry and is spawned directly.
      // Normal success output may mention the lockfile or packages whose names contain
      // words such as "error"; only explicit policy, integrity or terminal violations
      // may override an otherwise coherent zero exit.
      const normalSuccessEvidence = result.evidence.observedNonTransient === false
        && result.evidence.observedTransient === false
      const genericOnlyAdvisory = JSON.stringify(result.evidence.reasonCodes) === JSON.stringify(['GENERIC_TERMINAL'])
        && result.evidence.transientClassifications.length === 0
      const genericNetworkAdvisory = JSON.stringify(result.evidence.reasonCodes)
          === JSON.stringify(['GENERIC_TERMINAL', 'MIXED_EVIDENCE'])
        && JSON.stringify(result.evidence.transientClassifications) === JSON.stringify(['network'])
      const advisorySuccessEvidence = (genericOnlyAdvisory || genericNetworkAdvisory)
        && result.evidence.terminalClassification === null
        && result.evidence.allowlistedPnpmErrorCodes.length === 0
        && result.evidence.unknownPnpmErrorCodeCount === 0
        && result.evidence.unknownPnpmErrorCodeOverflow === false
        && result.evidence.httpStatusCodes.length === 0
      const cleanSuccess = result.exitCode === 0 && result.signal === null && !result.timedOut
        && !result.interrupted && (normalSuccessEvidence || advisorySuccessEvidence)
      if (cleanSuccess) {
        const entry = createAttempt(attempt, result, 'PASS', 'none'); attempts.push(entry); emitSummary(summary, entry, result)
        const minimum = attempts.reduce((total, item) => total + item.elapsedMs, 0) + policy.backoffMs * (attempts.length - 1)
        const totalElapsedMs = Math.max(minimum, Math.ceil(clock.now() - started))
        if (totalElapsedMs > policy.totalBudgetMs) throw fixedError('ERR_PNPM_PRODUCER_FETCH_DEADLINE', 'pnpm Producer fetch reached its global deadline')
        const receipt = requirePnpmProducerFetchReceipt({
          schemaVersion: policy.schemaVersion, status: 'PASS', packageManager: policy.packageManager,
          policy: policy.policy, rootContractDigest: policy.rootContractDigest,
          trustedPnpmVersion: policy.trustedPnpmVersion,
          trustedPnpmExecutablePolicy: policy.trustedPnpmExecutablePolicy, corepackPolicy: policy.corepackPolicy,
          maxAttempts: policy.maxAttempts, perAttemptTimeoutMs: policy.perAttemptTimeoutMs,
          killGraceMs: policy.killGraceMs,
          terminalObservationSlackMs: policy.terminalObservationSlackMs,
          backoffMs: policy.backoffMs, totalBudgetMs: policy.totalBudgetMs,
          producerMinimumReleaseAgeMinutes: policy.producerMinimumReleaseAgeMinutes,
          networkPolicy: policy.networkPolicy, userStoreDependency: policy.userStoreDependency,
          timeoutAuthority: policy.timeoutAuthority, attemptsUsed: attempts.length,
          transientFailures: attempts.length - 1, totalElapsedMs, attempts,
        })
        try {
          await writer(options.reportPath, receipt, Object.freeze({
            signal: controller.signal,
            ...(options.receiptWriterHooks ?? {}),
          }))
        } catch {
          if (controller.signal.aborted || clock.now() >= terminateBy) {
            throw fixedError('ERR_PNPM_PRODUCER_FETCH_DEADLINE', 'pnpm Producer fetch reached its global deadline')
          }
          throw fixedError('ERR_PNPM_PRODUCER_FETCH_RECEIPT', 'pnpm Producer fetch receipt commit failed closed')
        }
        if (controller.signal.aborted || clock.now() >= terminateBy) {
          throw fixedError('ERR_PNPM_PRODUCER_FETCH_DEADLINE', 'pnpm Producer fetch reached its global deadline')
        }
        return receipt
      }
      const classification = classifyResult(result)
      if (classification === null) {
        emitSummary(summary, createAttempt(attempt, result, 'FAIL_CLOSED', 'none'), result)
        throw fixedError('ERR_PNPM_PRODUCER_FETCH_NON_TRANSIENT', 'pnpm Producer fetch failed closed without a retryable terminal classification')
      }
      const entry = createAttempt(attempt, result, 'TRANSIENT_FAILURE', classification)
      attempts.push(entry); emitSummary(summary, entry, result)
      if (attempt === policy.maxAttempts) throw fixedError('ERR_PNPM_PRODUCER_FETCH_EXHAUSTED', 'pnpm Producer fetch exhausted its bounded retry policy')
      if (clock.now() + policy.backoffMs >= terminateBy) throw fixedError('ERR_PNPM_PRODUCER_FETCH_DEADLINE', 'pnpm Producer fetch retry would exceed its global deadline')
      try { await clock.sleep(policy.backoffMs, controller.signal) } catch { throw fixedError('ERR_PNPM_PRODUCER_FETCH_DEADLINE', 'pnpm Producer fetch reached its global deadline') }
    }
    throw fixedError('ERR_PNPM_PRODUCER_FETCH_STATE', 'pnpm Producer fetch reached an impossible retry state')
  } finally {
    clock.clearTimer(globalTimer)
    for (const [name, handler] of handlers) process.removeListener(name, handler)
  }
}

export async function runPnpmOfflineStoreFetchCli(options) {
  try {
    await runPnpmOfflineStoreFetch(options)
    return 0
  } catch (error) {
    let details
    if ((typeof error === 'object' || typeof error === 'function') && error !== null) {
      try { details = FIXED_ERROR_DETAILS.get(error) } catch {}
    }
    process.stderr.write(`${details?.message ?? 'pnpm Producer fetch failed closed'}\n`)
    return details?.code === 'ERR_PNPM_PRODUCER_FETCH_INTERRUPTED' ? 130 : 1
  }
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv.length !== 1 || argv[0] !== `--report=${RECEIPT_PATH}`) throw new Error(`pnpm Producer fetch CLI requires exactly --report=${RECEIPT_PATH}`)
  process.exitCode = await runPnpmOfflineStoreFetchCli({
    storeRoot: process.env[STORE_ROOT_VARIABLE],
    reportPath: RECEIPT_PATH,
    cwd: process.cwd(),
    environment: process.env,
  })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : 'pnpm Producer fetch failed closed'}\n`)
    process.exitCode = 1
  })
}
