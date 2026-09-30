import { afterEach, describe, expect, it, vi } from 'vitest'
import { PaimindFeaturePackService } from '../src/index.js'
import { PAIMIND_FEATURE_PACKS } from '../src/feature-packs.js'
import { FEATURE_RECONCILED_PACK_IDS, readFeatureChangePlan, type PaimindGovernedFeatureCommand } from '../src/governance.js'
import { PAIMIND_FEATURE_PACK_REMOTE_DESCRIPTORS } from '../src/remote.js'

const disposers: Array<() => void | Promise<void>> = []
afterEach(async () => { for (const close of disposers.splice(0)) await close(); vi.useRealTimers(); vi.restoreAllMocks() })
const beforeOverrides = JSON.stringify({ 'paimind:pack:operations': false })
const newStore = () => ({ value: { overrides: beforeOverrides, governance: '' }, revision: 4,
  failure: undefined as undefined | { phase: string; when: 'before' | 'after' },
  writes: [] as Array<{ overrides: string; governance: string }>, acceptedIntents: 0 })
type Store = ReturnType<typeof newStore>
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }
async function fixture(store = newStore()) {
  vi.useFakeTimers()
  let namespace: unknown, listener = () => {}
  const ownDisposers: Array<() => void | Promise<void>> = []
  const fails = new Set<string>()
  const state: { hook?: (id: string, enabled: boolean) => Promise<void> } = {}
  const entries = new Map(PAIMIND_FEATURE_PACKS.flatMap(pack => [pack.loaderEntryId, ...pack.capabilities.map(cap => cap.loaderEntryId)])
    .map(id => [id, { id, options: { id, name: 'cordis:group', group: true, disabled: true as boolean | undefined } }]))
  const settings = {
    writable: true,
    register(ns: unknown) { namespace = ns; return { get: () => store.value,
      watch(fn: () => void) { listener = fn; return () => { listener = () => {} } }, update: async () => {}, replace: async () => {} } },
    describe: () => [{ ns: namespace, value: store.value, revision: store.revision }],
    mutate: vi.fn(async (_ns: unknown, operations: readonly { op: string; path: readonly string[]; value?: unknown }[], expected: number) => {
      if (expected !== store.revision) throw Error('settings revision conflict')
      const next = { ...store.value }
      for (const op of operations) {
        if (op.op !== 'set' || op.path.length !== 1 || !['overrides', 'governance'].includes(op.path[0]!) || typeof op.value !== 'string') throw Error('invalid atomic field update')
        next[op.path[0] as keyof typeof next] = op.value
      }
      const phase = next.governance ? JSON.parse(next.governance).phase : undefined
      if (store.failure?.phase === phase && store.failure.when === 'before') throw Error('uncertain Settings write')
      store.value = next; store.revision += 1; store.writes.push({ ...next })
      if (phase === 'applying') store.acceptedIntents += 1
      listener()
      if (store.failure?.phase === phase && store.failure.when === 'after') throw Error('uncertain Settings write')
    }),
  }
  const loader = { entries: () => entries.values(), await: async () => {}, resolve: (id: string) => entries.get(id),
    update: vi.fn(async (id: string, patch: { disabled?: boolean | null }) => {
      const entry = entries.get(id); if (!entry) throw Error('missing Loader entry')
      await state.hook?.(id, patch.disabled !== true)
      if (patch.disabled !== true && fails.has(id)) throw Error('Cannot find package for ' + id)
      entry.options.disabled = patch.disabled === true ? true : undefined
    }),
  }
  const service = new PaimindFeaturePackService({ reflect: { provide: () => {} }, get: () => undefined, loader, settings,
    on: () => () => {}, effect(install: () => void | (() => void | Promise<void>)) {
      const close = install(); if (close) { disposers.push(close); ownDisposers.push(close) }
    },
  } as never)
  await vi.advanceTimersByTimeAsync(50)
  await (service as unknown as { reconciliation: Promise<void> }).reconciliation
  loader.update.mockClear(); settings.mutate.mockClear()
  return { service, store, loader, settings, fails, state, entries, close: () => Promise.all(ownDisposers.map(close => close())) }
}
async function command(f: Awaited<ReturnType<typeof fixture>>): Promise<PaimindGovernedFeatureCommand> {
  const selection = { id: 'paimind:pack:operations', enabled: true, expectedRevision: f.store.revision }
  const plan = await f.service.previewGovernedChange(selection)
  return { commandId: crypto.randomUUID(), requestDigest: 'sha256:' + 'a'.repeat(64), planDigest: plan.planDigest,
    selection, approvedPackIds: [...FEATURE_RECONCILED_PACK_IDS] }
}

describe('original Feature Pack governed-command owner, not enterprise authorization or Browser E2E', () => {
  it('normalizes JSONB object order without accepting changed plan identity or extra fields', async () => {
    const f = await fixture(), c = await command(f), plan = await f.service.previewGovernedChange(c.selection)
    const reordered = Object.fromEntries(Object.entries(plan).reverse())
    reordered.selection = Object.fromEntries(Object.entries(plan.selection).reverse())
    expect(readFeatureChangePlan(reordered)).toEqual(plan)
    for (const changed of [{ ...reordered, after: '{}' }, { ...reordered, extra: true },
      { ...reordered, reconciledPackIds: [...plan.reconciledPackIds].reverse() },
      { ...reordered, selection: { ...plan.selection, enabled: false } }]) expect(() => readFeatureChangePlan(changed)).toThrow()
  })
  it('previews the entire reconciliation impact without writes and rejects incomplete approval or a stale plan', async () => {
    const f = await fixture(), c = await command(f), plan = await f.service.previewGovernedChange(c.selection)
    expect(plan.reconciledPackIds).toEqual(FEATURE_RECONCILED_PACK_IDS)
    expect(plan.before).toBe(beforeOverrides)
    expect(JSON.parse(plan.after)).toEqual({ 'paimind:pack:operations': true, 'paimind:pack:content': true })
    await expect(f.service.applyGovernedChange({ ...c, approvedPackIds: ['paimind:pack:operations'] })).rejects.toThrow('Approval must cover every Product Pack')
    await expect(f.service.applyGovernedChange({ ...c, planDigest: 'sha256:' + 'b'.repeat(64) })).rejects.toThrow('plan changed')
    expect(f.store.writes).toHaveLength(0); expect(f.loader.update).not.toHaveBeenCalled()
    expect(PAIMIND_FEATURE_PACK_REMOTE_DESCRIPTORS.map(row => row.method)).toEqual(['describe', 'mutate'])
  })

  it('atomically accepts intent before Loader access, records completion, and replays without another transition', async () => {
    const f = await fixture(), c = await command(f)
    f.state.hook = async () => { expect(JSON.parse(f.store.value.governance).phase).toBe('applying') }
    const result = await f.service.applyGovernedChange(c)
    expect(result.command?.phase).toBe('applied'); expect(result.replayed).toBe(false)
    expect(f.store.writes).toHaveLength(2); expect(f.store.acceptedIntents).toBe(1)
    const updates = f.loader.update.mock.calls.length
    expect((await f.service.applyGovernedChange(c)).replayed).toBe(true)
    expect(f.loader.update).toHaveBeenCalledTimes(updates); expect(f.store.writes).toHaveLength(2)
    await expect(f.service.applyGovernedChange({ ...c, requestDigest: 'sha256:' + 'b'.repeat(64) })).rejects.toThrow('identity conflict')
    await expect(f.service.mutate({ ...c.selection, expectedRevision: f.store.revision })).rejects.toThrow('enterprise governance')
  })

  it.each(['before', 'after'] as const)('recovers an uncertain initial intent write (%s commit) without double acceptance', async when => {
    const f = await fixture(), c = await command(f)
    f.store.failure = { phase: 'applying', when }
    await expect(f.service.applyGovernedChange(c)).rejects.toThrow('uncertain Settings write')
    expect(f.loader.update).not.toHaveBeenCalled()
    expect(f.store.acceptedIntents).toBe(when === 'after' ? 1 : 0)
    f.store.failure = undefined
    expect((await f.service.applyGovernedChange(c)).command?.phase).toBe('applied')
    expect(f.store.acceptedIntents).toBe(1)
  })

  it('keeps unconfirmed desired state pending across a cold owner and requires current approval to resume', async () => {
    const f = await fixture(), c = await command(f)
    f.store.failure = { phase: 'applied', when: 'before' }
    await expect(f.service.applyGovernedChange(c)).rejects.toThrow('uncertain Settings write')
    expect(JSON.parse(f.store.value.governance).phase).toBe('applying')
    await f.close(); f.store.failure = undefined; f.store.revision = 0
    const cold = await fixture(f.store)
    expect(cold.entries.get('paimind-pack-operations')?.options.disabled).toBe(true)
    expect(JSON.parse(cold.store.value.governance).phase).toBe('applying')
    expect(cold.store.acceptedIntents).toBe(1)
    await expect(cold.service.applyGovernedChange({ ...c, approvedPackIds: [] })).rejects.toThrow('Approval must cover every Product Pack')
    expect(cold.entries.get('paimind-pack-operations')?.options.disabled).toBe(true)
    expect((await cold.service.applyGovernedChange(c)).command?.phase).toBe('applied')
    expect(cold.store.acceptedIntents).toBe(1)
    expect(cold.entries.get('paimind-pack-operations')?.options.disabled).not.toBe(true)
  })

  it('confirms a completed receipt after a lost response without toggling again', async () => {
    const f = await fixture(), c = await command(f)
    f.store.failure = { phase: 'applied', when: 'after' }
    await expect(f.service.applyGovernedChange(c)).rejects.toThrow('uncertain Settings write')
    expect(JSON.parse(f.store.value.governance).phase).toBe('applied')
    const count = f.loader.update.mock.calls.length; f.store.failure = undefined
    expect((await f.service.applyGovernedChange(c)).replayed).toBe(true)
    expect(f.loader.update).toHaveBeenCalledTimes(count)
  })

  it('retains a rolled-back outcome and does not retry a failed enable under the same command', async () => {
    const f = await fixture(), c = await command(f); f.fails.add('paimind-pack-operations')
    const result = await f.service.applyGovernedChange(c)
    expect(result.command?.phase).toBe('rolled-back'); expect(f.store.value.overrides).toBe(beforeOverrides)
    expect(f.store.writes.map(row => JSON.parse(row.governance).phase)).toEqual(['applying', 'rolling-back', 'rolled-back'])
    const count = f.loader.update.mock.calls.length; f.fails.clear()
    expect((await f.service.applyGovernedChange(c)).replayed).toBe(true)
    expect(f.loader.update).toHaveBeenCalledTimes(count)
    expect((await f.service.applyGovernedChange(await command(f))).command?.phase).toBe('applied')
  })

  it('does not mark incomplete rollback successful and resumes rollback rather than the rejected enable', async () => {
    const f = await fixture(), c = await command(f)
    f.fails.add('paimind-pack-content'); f.fails.add('paimind-pack-operations')
    await expect(f.service.applyGovernedChange(c)).rejects.toThrow('requires rollback recovery')
    expect(JSON.parse(f.store.value.governance).phase).toBe('rolling-back')
    await expect(f.service.previewGovernedChange({ ...c.selection, expectedRevision: f.store.revision })).rejects.toThrow('requires confirmation or recovery')
    f.fails.clear()
    expect((await f.service.applyGovernedChange(c)).command?.phase).toBe('rolled-back')
    expect(f.entries.get('paimind-pack-operations')?.options.disabled).toBe(true)
  })

  it('reports pending acceptance while Loader work is active; cancelling waiting does not undo accepted intent', async () => {
    const f = await fixture(), c = await command(f), entered = deferred(), release = deferred(), abort = new AbortController()
    f.state.hook = async (id, enabled) => { if (id === 'paimind-pack-operations' && enabled) { entered.resolve(); await release.promise } }
    const work = f.service.applyGovernedChange(c, abort.signal)
    await Promise.race([entered.promise, work.then(() => { throw Error('Command settled before entering Loader gate') })])
    try { expect((await f.service.describeGovernedFeatures()).command?.phase).toBe('applying'); abort.abort() }
    finally { release.resolve() }
    expect((await work).command?.phase).toBe('applied')
    expect(f.store.acceptedIntents).toBe(1)
  })

  it('does not mistake a desired-state-masked product view for a successful native disable', async () => {
    const f = await fixture(); await f.service.applyGovernedChange(await command(f))
    const selection = { id: 'paimind:pack:operations', enabled: false, expectedRevision: f.store.revision }
    const plan = await f.service.previewGovernedChange(selection)
    const original = f.loader.update.getMockImplementation()!
    f.loader.update.mockImplementation(async (id, patch) => {
      if (id === 'paimind-pack-operations' && patch.disabled === true) return
      await original(id, patch)
    })
    const result = await f.service.applyGovernedChange({ commandId: crypto.randomUUID(), requestDigest: 'sha256:' + 'c'.repeat(64),
      planDigest: plan.planDigest, selection, approvedPackIds: [...FEATURE_RECONCILED_PACK_IDS] })
    expect(result.command?.phase).toBe('rolled-back')
    expect(f.entries.get('paimind-pack-operations')?.options.disabled).not.toBe(true)
    expect(JSON.parse(f.store.value.overrides)['paimind:pack:operations']).toBe(true)
  })

  it('fails closed on a drifted governed namespace without overwriting the external value', async () => {
    const f = await fixture(), c = await command(f); await f.service.applyGovernedChange(c)
    f.store.value.overrides = '{}'; f.store.revision += 1
    const writes = f.store.writes.length
    await expect(f.service.describeGovernedFeatures()).rejects.toThrow('changed outside its owner')
    await expect(f.service.applyGovernedChange(c)).rejects.toThrow('changed outside its owner')
    expect(f.store.value.overrides).toBe('{}'); expect(f.store.writes).toHaveLength(writes)
  })
})
