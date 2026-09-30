import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import type { Context } from '@deepseek-ai/cordis'
import { captureConnectorToolOrigin } from './connector-tool-origin.js'
import { captureManagedHarnessOrigins, type ManagedHarnessOrigins } from './managed-origins.js'
import type { createNativeConnectorConfiguration } from './connector-configuration.js'

type Owner = Awaited<ReturnType<typeof createNativeConnectorConfiguration>>
type Reference = NonNullable<ReturnType<Owner['release']>['reference']>
interface Provenance { readonly entryId: string | null; readonly serverName: string; readonly transport: string; readonly instanceId: string }
interface Authority {
  readonly signal: AbortSignal
  readApproval(reference: Reference, expectedRevision: number | null, signal: AbortSignal): Promise<number>
  authorizeUse(origins: ManagedHarnessOrigins, reference: Reference, approvalRevision: number, signal: AbortSignal): Promise<void>
}
const failure = () => new Error('当前连接器批准或执行权限已失效')
const owners = new WeakSet<Context>()
const intervalMs = 1000, validForMs = 4000, requestMs = 1500
const same = (a: Reference, b: Reference) => a.entryId === b.entryId && a.configurationVersion === b.configurationVersion
  && a.serverName === b.serverName && a.transport === b.transport

/** Bound even an authority implementation which ignores cancellation. A late
 * answer is discarded and cannot renew a dead lifetime or a different call. */
async function bounded<T>(signal: AbortSignal, read: (signal: AbortSignal) => Promise<T>): Promise<T> {
  signal.throwIfAborted()
  const deadline = new AbortController(), combined = AbortSignal.any([signal, deadline.signal])
  const timer = setTimeout(() => deadline.abort(failure()), requestMs); timer.unref()
  let abort: () => void = () => {}
  const canceled = new Promise<never>((_resolve, reject) => { abort = () => reject(failure()); combined.addEventListener('abort', abort, { once: true }) })
  try { combined.throwIfAborted(); return await Promise.race([Promise.resolve().then(() => read(combined)), canceled]) }
  finally { clearTimeout(timer); combined.removeEventListener('abort', abort) }
}

/** Original Include/Loader retains all persistent configuration and process,
 * socket and tool ownership. This root-owned controller only supplies/withdraws
 * its exact dependency lifetime and checks current authority at actual dispatch.
 * No grant, timer, browser source or live connection survives root disposal. */
export function createManagedConnectorAuthority(root: Context, owner: Owner, authority: Authority) {
  assert.equal(root, root.root); assert.ok(!owners.has(root)); assert.ok(authority.signal instanceof AbortSignal)
  assert.equal(typeof authority.readApproval, 'function'); assert.equal(typeof authority.authorizeUse, 'function')
  owners.add(root)
  type Lease = { reference: Reference; revision: number; signal: AbortSignal; active: boolean; expires: number; close(): Promise<void> }
  const leases = new Map<string, Lease>(), draining = new Set<Promise<void>>()
  let live = true, busy = false
  const current = (signal: AbortSignal) => { signal.throwIfAborted(); authority.signal.throwIfAborted(); if (!live) throw failure() }
  const state = (signal: AbortSignal) => { current(signal); return owner.activationState(signal) }
  const select = (reference: Reference, signal: AbortSignal) => {
    const view = state(signal), row = view.entries.find(row => row.entryId === reference.entryId)
    if (!row || !row.enabled || row.configurationVersion !== reference.configurationVersion
      || row.serverName !== reference.serverName || row.transport !== reference.transport || row.authority !== 'live' || row.phase !== 2) throw failure()
  }
  const leaseFor = (provenance: Provenance | undefined): Lease => {
    if (!provenance || typeof provenance.entryId !== 'string' || !provenance.entryId.startsWith('paimind-managed-connectors:')) throw failure()
    const id = provenance.entryId.slice('paimind-managed-connectors:'.length), lease = leases.get(id)
    if (!lease || !lease.active || lease.expires <= performance.now() || lease.reference.serverName !== provenance.serverName
      || lease.reference.transport !== provenance.transport) throw failure()
    current(lease.signal); select(lease.reference, lease.signal)
    return lease
  }
  const read = async (reference: Reference, expected: number | null, signal: AbortSignal) => {
    current(signal)
    const revision = await bounded(AbortSignal.any([signal, authority.signal]), cancellation => authority.readApproval(reference, expected, cancellation))
    current(signal)
    if (!Number.isSafeInteger(revision) || revision < 1 || revision > 2147483647 || expected !== null && revision !== expected) throw failure()
    return revision
  }
  const createLease = (reference: Reference, revision: number, checkedAt: number): Lease => {
    if (checkedAt + validForMs <= performance.now()) throw failure()
    const controller = new AbortController()
    let expiry: ReturnType<typeof setTimeout>, renewal: ReturnType<typeof setTimeout> | undefined, closure: Promise<void> | undefined
    let release: () => unknown
    const lease: Lease = { reference, revision, signal: controller.signal, active: false, expires: checkedAt + validForMs,
      close() {
        if (closure) return closure
        closure = Promise.resolve(release()).then(() => {})
        const done = closure
        draining.add(done); void done.then(() => draining.delete(done), () => draining.delete(done))
        return done
      } }
    const stop = () => { void lease.close().catch(() => {}) }
    const arm = () => {
      clearTimeout(expiry)
      expiry = setTimeout(stop, Math.max(0, lease.expires - performance.now())); expiry.unref()
    }
    const renew = async () => {
      const started = performance.now()
      try {
        await read(reference, revision, controller.signal)
        if (controller.signal.aborted || leases.get(reference.entryId) !== lease || lease.expires <= performance.now()) throw failure()
        // Serial renewal; never extend expiry while a read is merely pending.
        lease.expires = started + validForMs; arm()
        renewal = setTimeout(() => void renew(), intervalMs); renewal.unref()
      } catch { stop() }
    }
    release = root.effect(() => {
      leases.set(reference.entryId, lease); authority.signal.addEventListener('abort', stop, { once: true })
      arm(); renewal = setTimeout(() => void renew(), intervalMs); renewal.unref()
      return () => {
        lease.active = false; clearTimeout(expiry); clearTimeout(renewal)
        authority.signal.removeEventListener('abort', stop)
        if (leases.get(reference.entryId) === lease) leases.delete(reference.entryId)
        controller.abort(failure())
        return owner.withdrawActivation(reference.entryId).catch(error => { live = false; throw error })
      }
    })
    if (authority.signal.aborted) stop()
    return lease
  }
  const activate = async (input: Parameters<Owner['setActivation']>[0], signal: AbortSignal, expectedApprovalRevision: number | null = null) => {
    current(signal); if (busy) throw failure()
    if (expectedApprovalRevision !== null && (!Number.isSafeInteger(expectedApprovalRevision) || expectedApprovalRevision < 1 || expectedApprovalRevision > 2147483647)) throw failure()
    busy = true
    let lease: Lease | undefined
    try {
      const result = await owner.setActivation(input, signal, async (reference, cancellation) => {
        if (lease) {
          if (!same(reference, lease.reference)) throw failure()
          await read(reference, lease.revision, AbortSignal.any([cancellation, lease.signal]))
        } else {
          const started = performance.now(), revision = await read(reference, expectedApprovalRevision, cancellation)
          await leases.get(reference.entryId)?.close()
          lease = createLease(reference, revision, started)
        }
        current(lease.signal)
        return lease.signal
      })
      if (result.outcome === 'activated' && lease) {
        current(lease.signal); select(lease.reference, lease.signal); lease.active = true
      } else if (result.outcome === 'disabled') {
        for (const row of result.state.entries) if (!row.enabled) await leases.get(row.entryId)?.close()
      }
      return result
    } catch (error) { await lease?.close(); throw error }
    finally { busy = false }
  }
  // Installed on the original root dispatch, not a second invocation route.
  // The native registry's final synchronous body check separately protects
  // against later asynchronous wrappers swapping the scoped definition.
  root.on('tools/execute', async (execution, next) => {
    const provenance = captureConnectorToolOrigin(root, execution)
    if (!provenance?.reference) return next()
    const lease = leaseFor(provenance.reference)
    if (!execution.agent) throw failure()
    const origins = captureManagedHarnessOrigins(root, execution.agent)
    const signal = AbortSignal.any([execution.signal, lease.signal, authority.signal, origins.signal])
    await bounded(signal, cancellation => authority.authorizeUse(origins.input, lease.reference, lease.revision, cancellation))
    current(signal); provenance.assertCurrent(); origins.assertCurrent()
    if (leaseFor(provenance.reference) !== lease) throw failure()
    execution.signal = signal
    const result = await next()
    // A remote side effect cannot be rolled back here. Still withhold its
    // result if permission changed while it ran; a local lease is not enough.
    await bounded(signal, cancellation => authority.authorizeUse(origins.input, lease.reference, lease.revision, cancellation))
    current(signal); provenance.assertCurrent(); origins.assertCurrent()
    if (leaseFor(provenance.reference) !== lease) throw failure()
    return result
  }, { prepend: true })
  root.effect(() => async () => {
    live = false
    await Promise.all([...leases.values()].map(lease => lease.close()))
    await Promise.all([...draining])
  })
  return Object.freeze({
    activate,
    admits(provenance: Provenance | undefined) { try { leaseFor(provenance); return true } catch { return false } },
    async withdraw(entryId: string) { await leases.get(entryId)?.close(); await owner.withdrawActivation(entryId) },
    async restore(signal: AbortSignal) {
      const entries = state(signal).entries.filter(row => row.enabled)
      const restored: string[] = [], pending: string[] = []
      for (const row of entries) {
        current(signal)
        const view = state(signal), now = view.entries.find(current => current.entryId === row.entryId)
        if (!now?.enabled || !now.configurationVersion || now.configurationVersion !== row.configurationVersion) { pending.push(row.entryId); continue }
        const existing = leases.get(row.entryId)
        if (existing?.active && now.authority === 'live') {
          try {
            await read(existing.reference, existing.revision, AbortSignal.any([signal, existing.signal]))
            current(existing.signal); select(existing.reference, existing.signal)
            if (leases.get(row.entryId) !== existing || existing.expires <= performance.now()) throw failure()
            restored.push(row.entryId)
          } catch { await existing.close(); current(signal); pending.push(row.entryId) }
          continue
        }
        try {
          const result = await activate({ entryId: row.entryId, configurationVersion: row.configurationVersion,
            expectedRevision: view.revision, enabled: true }, signal)
          if (result.outcome !== 'activated') throw failure()
          restored.push(row.entryId)
        } catch { current(signal); pending.push(row.entryId) }
      }
      return { restored, pending }
    },
  })
}
