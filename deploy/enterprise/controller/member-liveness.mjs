import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

/** Only program-owned metadata leaves the child boundary. Never retain its
 * arguments, output, executable path or the caller's arbitrary abort reason. */
export class BoundedCommandError extends Error {
  constructor(kind, { pid, exitCode = null, signal = null, spawnCode, elapsedMs, outputBytes = 0, stderrCategory }) {
    super(`Owned command did not complete (${kind})`)
    this.name = 'BoundedCommandError'
    this.diagnostic = Object.freeze({ kind, ...(pid === undefined ? {} : { pid }), exitCode, signal,
      ...(spawnCode ? { spawnCode } : {}), elapsedMs, outputBytes,
      ...(stderrCategory ? { stderrCategory } : {}) })
    // Preserve the existing joined-child readback fields for callers.
    this.pid = pid; this.exitCode = exitCode; this.signal = signal
  }
}

// A diagnostic label only, never a retry or authorization decision. Arbitrary
// engine output is neither persisted nor attached to the returned error.
function dockerFailureCategory(prefix) {
  if (/no such (?:object|container|network|volume)/i.test(prefix)) return 'object-missing'
  if (/permission denied|operation not permitted/i.test(prefix)) return 'permission-denied'
  if (/too many open files|resource temporarily unavailable|cannot allocate memory/i.test(prefix)) return 'resource-exhausted'
  if (/context deadline exceeded|i\/o timeout|TLS handshake timeout/i.test(prefix)) return 'transport-timeout'
  if (/cannot connect to the docker daemon|failed to connect to the docker API at |error during connect:|connection refused|connection reset by peer/i.test(prefix)) return 'engine-unavailable'
  if (/internal server error|service unavailable|bad gateway/i.test(prefix)) return 'engine-api-error'
  return 'unclassified'
}

const probeStages = new Set(['runtime-logs', 'runtime-container', 'runtime-network', 'runtime-storage', 'runtime-references', 'storage-fence'])
const ownedProbeErrors = new WeakSet()
const commandKinds = new Set(['aborted-before-start', 'aborted', 'timeout', 'output-overflow', 'spawn-error', 'signal-exit', 'nonzero-exit', 'unclassified'])
function safeCommandDiagnostic(value) {
  if (!value || !commandKinds.has(value.kind)) return undefined
  const safe = { kind: value.kind }
  for (const key of ['pid', 'elapsedMs', 'outputBytes']) if (Number.isSafeInteger(value[key]) && value[key] >= 0) safe[key] = value[key]
  if (value.exitCode === null || Number.isInteger(value.exitCode) && value.exitCode >= -255 && value.exitCode <= 255) safe.exitCode = value.exitCode
  if (value.signal === null || ['SIGKILL','SIGTERM','SIGINT','SIGABRT','SIGSEGV','SIGHUP','SIGPIPE'].includes(value.signal)) safe.signal = value.signal
  if (['ENOENT','EACCES','EAGAIN','EMFILE','ENFILE','ENOMEM'].includes(value.spawnCode)) safe.spawnCode = value.spawnCode
  if (['object-missing','permission-denied','resource-exhausted','transport-timeout','engine-unavailable','engine-api-error','unclassified'].includes(value.stderrCategory)) safe.stderrCategory = value.stderrCategory
  return Object.freeze(safe)
}
/** Fixed program-owned read stage and exact non-secret engine objects only.
 * The caller's raw exception/cause/output never escapes this wrapper. */
export async function runOwnedProbe(stage, targets, work) {
  assert.ok(probeStages.has(stage))
  const targetIds = Array.isArray(targets) ? [...targets] : [targets]
  assert.ok(targetIds.length > 0 && targetIds.length <= 2)
  for (const id of targetIds) assert.ok(typeof id === 'string' && (/^[a-f0-9]{64}$/.test(id)
    || /^paimind-haas-member-[a-z0-9-]{1,160}-(?:data|control)$/.test(id)))
  assert.equal(typeof work, 'function')
  try { return await work() }
  catch (error) {
    const diagnostic = safeCommandDiagnostic(error instanceof BoundedCommandError ? error.diagnostic : error?.commandDiagnostic)
    const failure = Object.assign(Error(`Owned probe unavailable (${stage})`), {
      ownedProbe: Object.freeze({ stage, targetIds: Object.freeze(targetIds) }),
      ...(diagnostic ? { commandDiagnostic: diagnostic } : {}),
    })
    ownedProbeErrors.add(failure)
    throw failure
  }
}

/** Read-only renewal observation, never a lease grant or runtime recovery.
 * The caller supplies its original total deadline and repeats ALL ownership,
 * resource, native-health and fence checks. Only a diagnosed connection failure
 * from this module's fixed owned probes permits one fresh observation; no partial
 * result survives. Mutations, native requests, policy failures and elapsed
 * deadlines never retry. The database still rejects expired/replaced leases. */
export async function readLeaseObservation(observe, { signal, onRetry }) {
  assert.equal(typeof observe, 'function')
  assert.ok(signal instanceof AbortSignal)
  assert.equal(typeof onRetry, 'function')
  for (let attempt = 1; attempt <= 2; attempt++) {
    signal.throwIfAborted()
    try {
      const value = await observe(signal)
      signal.throwIfAborted()
      return { value, attempts: attempt }
    } catch (error) {
      const diagnostic = error?.commandDiagnostic
      if (attempt !== 1 || signal.aborted || !ownedProbeErrors.has(error)
        || diagnostic?.kind !== 'nonzero-exit' || diagnostic.exitCode !== 1
        || diagnostic.signal !== null || diagnostic.stderrCategory !== 'engine-unavailable') throw error
      // Never lose the initial failure when a fresh read succeeds. The callback
      // receives only metadata already allowlisted by runOwnedProbe.
      await onRetry({ ownedProbe: error.ownedProbe, commandDiagnostic: diagnostic })
      await delay(250, undefined, { signal })
    }
  }
}

/** Trusted operator command only. Cancellation/timeout never means the engine
 * mutation was rolled back: callers must read it back. Always join the exact
 * CLI child, including overflow, abort and spawn errors, before returning. */
export function runBoundedCommand(executable, args, { signal, timeoutMs = 5000, diagnosticProfile } = {}) {
  assert.ok(typeof executable === 'string' && Array.isArray(args) && args.every(arg => typeof arg === 'string'))
  assert.ok(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60000)
  assert.ok(diagnosticProfile === undefined || diagnosticProfile === 'docker')
  if (signal?.aborted) throw new BoundedCommandError('aborted-before-start', { elapsedMs: 0 })
  return new Promise((resolve, reject) => {
    const started = performance.now()
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks = [], stderrPrefix = []; let size = 0, stderrPrefixBytes = 0, failureKind, spawnCode
    // Keep the first observed cause; SIGKILL is an effect of cancellation,
    // not evidence that the engine itself chose to terminate the command.
    const cancel = kind => { failureKind ??= kind; child.kill('SIGKILL') }
    const onAbort = () => cancel('aborted')
    const timer = setTimeout(() => cancel('timeout'), timeoutMs)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
    child.on('error', error => {
      failureKind ??= 'spawn-error'
      if (typeof error.code === 'string' && /^[A-Z][A-Z0-9_]{1,31}$/.test(error.code)) spawnCode = error.code
    })
    child.stdout.on('data', bytes => { size += bytes.length; if (size > 4 * 1024 ** 2) cancel('output-overflow'); else if (!failureKind) chunks.push(bytes) })
    child.stderr.on('data', bytes => {
      size += bytes.length
      if (diagnosticProfile === 'docker' && stderrPrefixBytes < 4096) {
        const part = bytes.subarray(0, 4096 - stderrPrefixBytes)
        stderrPrefix.push(Buffer.from(part)); stderrPrefixBytes += part.length
      }
      if (size > 4 * 1024 ** 2) cancel('output-overflow')
    })
    child.once('close', (code, exitSignal) => {
      clearTimeout(timer); signal?.removeEventListener('abort', onAbort)
      if (failureKind || code !== 0 || exitSignal) reject(new BoundedCommandError(failureKind ?? (exitSignal ? 'signal-exit' : 'nonzero-exit'), {
        pid: child.pid, exitCode: code, signal: exitSignal, spawnCode,
        elapsedMs: Math.round(performance.now() - started), outputBytes: size,
        ...(diagnosticProfile === 'docker' ? { stderrCategory: dockerFailureCategory(Buffer.concat(stderrPrefix).toString('utf8')) } : {}),
      }))
      else resolve(Buffer.concat(chunks).toString('utf8').trim())
    })
  })
}

/** One serial lane per immutable member, not one shared serial lane. Callers
 * must supply bounded nonblocking I/O; a failed lane never renews again, while
 * another member can continue during its observation or withdrawal. Cancellation
 * joins every lane before the operator's final resource cleanup begins. */
export async function maintainMemberLeases(cells, { cycle, withdraw, onTerminal, waitForRecovery, signal, intervalMs = 5000 }) {
  assert.ok(Array.isArray(cells) && cells.length > 0 && cells.length <= 128)
  assert.equal(new Set(cells.map(cell => cell.pin.cellId)).size, cells.length)
  assert.ok(signal instanceof AbortSignal && Number.isInteger(intervalMs) && intervalMs >= 1)
  return Promise.allSettled(cells.map(async initial => {
    let cell = initial
    while (!signal.aborted) try {
      while (!signal.aborted) {
        await cycle(cell, signal)
        if (signal.aborted) break
        await delay(intervalMs, undefined, { signal })
      }
      return { cellId: cell.pin.cellId, state: 'stopped' }
    } catch (error) {
      if (signal.aborted) return { cellId: cell.pin.cellId, state: 'stopped' }
      let outcome
      try { await withdraw(cell, error); outcome = { state: 'withdrawn', error } }
      catch (withdrawalError) { outcome = { state: 'withdrawal-unconfirmed', error, withdrawalError } }
      await onTerminal(cell, outcome)
      if (outcome.state === 'withdrawn' && waitForRecovery) {
        // Only this lane waits. A recovery command never revives the old pin;
        // its operator must return an independently verified new container.
        let next
        try { next = await waitForRecovery(cell, signal) }
        catch (error) { if (signal.aborted) break; throw error }
        if (signal.aborted) break
        if (next) {
          for (const key of ['cellId', 'tenantId', 'userId', 'role', 'volumeName', 'imageId', 'policyDigest']) {
            assert.equal(next.pin[key], cell.pin[key], 'Recovered member ownership changed')
          }
          assert.notEqual(next.pin.revision, cell.pin.revision, 'Recovery requires a new revision')
          assert.notEqual(next.pin.containerId, cell.pin.containerId, 'Recovery requires a new container')
          cell = next
          continue
        }
      }
      return { cellId: cell.pin.cellId, state: outcome.state }
    }
    return { cellId: cell.pin.cellId, state: 'stopped' }
  }))
}
