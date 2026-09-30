import assert from 'node:assert/strict'
import { isDeepStrictEqual } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'

/** Lifecycle-owned inbox read while one original lane is dormant. This neither
 * schedules new recoveries nor retries claimed commands. A terminal/unknown
 * result stops reads; existing manual inspection and shutdown remain usable.
 * A transport failure may retry an inbox read, never a durably claimed action. */
export async function waitForAdministratorRecovery(waiting, { signal, poll, onError, intervalMs = 5000 }) {
  assert.ok(Number.isInteger(intervalMs) && intervalMs > 0)
  const lifetime = new AbortController(), combined = AbortSignal.any([signal, lifetime.signal])
  const result = Promise.resolve(waiting).finally(() => lifetime.abort())
  const polling = (async () => {
    let unavailable = false
    try {
      while (!combined.aborted) {
        try { if (await poll(combined) === false) break; unavailable = false }
        catch (error) {
          if (combined.aborted) break
          if (!unavailable) await onError(error)
          unavailable = true
        }
        await delay(intervalMs, undefined, { signal: combined })
      }
    } catch (error) { if (!combined.aborted) await onError(error) }
  })()
  try { return await result } finally { lifetime.abort(); await polling }
}

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u
export function readMemberRecoveryCommand(value) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value))
  assert.deepEqual(Object.keys(value).sort(), ['cellId', 'expectedRevision', 'requestId'])
  for (const key of ['cellId', 'expectedRevision', 'requestId']) assert.match(value[key], uuid)
  return Object.freeze({ ...value })
}

/** An explicit operator request rendezvous, not a runtime or identity registry.
 * Only a lane whose withdrawal has completed may register. Engine recovery,
 * immutable admission and gateway acknowledgement stay with its actual owner.
 * Uncertain recovery never retries automatically or wakes a different lane. */
export class MemberRecoveryRequests {
  #waiting = new Map()
  #last
  #busy = false
  wait(cell, signal) {
    signal.throwIfAborted()
    assert.ok(!this.#waiting.has(cell.pin.cellId), 'Member already waiting for recovery')
    const { promise, resolve, reject } = Promise.withResolvers()
    const entry = { cell, signal, resolve, reject, state: 'withdrawn' }
    const abort = () => { this.#waiting.delete(cell.pin.cellId); reject(signal.reason) }
    entry.release = () => signal.removeEventListener('abort', abort)
    this.#waiting.set(cell.pin.cellId, entry)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    return promise.finally(entry.release)
  }
  snapshot() {
    return [...this.#waiting.values()].map(entry => Object.freeze({ cellId: entry.cell.pin.cellId,
      revision: entry.cell.pin.revision, state: entry.state }))
  }
  recover(input, operation) {
    const command = readMemberRecoveryCommand(input)
    if (this.#last?.command.requestId === command.requestId) {
      assert.ok(isDeepStrictEqual(this.#last.command, command), 'Recovery request identity reused with different input')
      return this.#last.promise
    }
    assert.equal(this.#busy, false, 'Another member recovery is in progress')
    const entry = this.#waiting.get(command.cellId)
    assert.ok(entry && entry.state === 'withdrawn' && entry.cell.pin.revision === command.expectedRevision,
      'Recovery requires the exact withdrawn member revision')
    entry.signal.throwIfAborted()
    this.#busy = true; entry.state = 'recovering'
    const promise = (async () => {
      try {
        const next = await operation(entry.cell, command, entry.signal)
        entry.signal.throwIfAborted()
        assert.ok(next && next !== entry.cell && next.pin, 'Recovery must return a new member cell')
        for (const key of ['cellId', 'tenantId', 'userId', 'role', 'volumeName', 'imageId', 'policyDigest']) {
          assert.equal(next.pin[key], entry.cell.pin[key], 'Recovered member ownership changed')
        }
        assert.notEqual(next.pin.revision, entry.cell.pin.revision)
        assert.notEqual(next.pin.containerId, entry.cell.pin.containerId)
        this.#waiting.delete(command.cellId); entry.resolve(next)
        return Object.freeze({ requestId: command.requestId, cellId: next.pin.cellId, revision: next.pin.revision, status: 'recovered' })
      } catch (error) {
        // The engine/database may have accepted part of an interrupted request.
        // Keep this lane dormant and require inspection, not a second mutation.
        entry.state = 'recovery-unconfirmed'
        throw error
      } finally { this.#busy = false }
    })()
    this.#last = { command, promise }
    return promise
  }
}
