import { afterEach, describe, expect, it, vi } from 'vitest'
import { PAIMIND_FEATURE_PACKS } from '../src/feature-packs.js'
import { PaimindFeaturePackService } from '../src/index.js'

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close()
  vi.useRealTimers(); vi.restoreAllMocks()
})
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
function fixture(fail: boolean) {
  vi.useFakeTimers()
  let revision = 4, namespace: unknown, watch = () => {}
  const value = { overrides: JSON.stringify({ 'paimind:pack:operations': false }) }
  const entered = deferred(), release = deferred()
  const ownedCleanups: Array<() => void | Promise<void>> = []
  let gateUnused = true, active = 0, maximum = 0
  const entries = new Map<string, { id: string; options: { id: string; name: string; group: boolean; disabled?: boolean } }>(
    PAIMIND_FEATURE_PACKS.flatMap(pack => [pack.loaderEntryId, ...pack.capabilities.map(cap => cap.loaderEntryId)])
      .map(id => [id, { id, options: { id, name: 'cordis:group', group: true, ...(id === 'paimind-pack-operations' ? { disabled: true } : {}) } }]))
  const settings = {
    writable: true,
    register(ns: unknown) {
      namespace = ns
      return { get: () => value, watch(listener: () => void) { watch = listener; return () => { watch = () => {} } }, update: async () => {}, replace: async () => {} }
    },
    describe: () => [{ ns: namespace, value, revision }],
    mutate: vi.fn(async (_ns: unknown, operations: readonly { path: readonly string[]; value?: unknown }[], expected: number) => {
      if (expected !== revision) throw Error('settings revision conflict')
      expect(operations[0]?.path).toEqual(['overrides'])
      value.overrides = String(operations[0]?.value); revision += 1; watch()
    }),
  }
  const loader = {
    entries: () => entries.values(), await: async () => {},
    resolve: (id: string) => entries.get(id),
    update: vi.fn(async (id: string, options: { disabled?: boolean | null }) => {
      active += 1; maximum = Math.max(maximum, active)
      try {
        const entry = entries.get(id)!
        if (id === 'paimind-pack-operations' && options.disabled !== true && gateUnused) {
          gateUnused = false; entered.resolve(); await release.promise
          if (fail) throw Error('Cannot find package @paimind/task-monitor')
        }
        if (options.disabled === true) entry.options.disabled = true; else delete entry.options.disabled
      } finally { active -= 1 }
    }),
  }
  const service = new PaimindFeaturePackService({ reflect: { provide: () => {} }, get: () => undefined, loader, settings,
    effect(install: () => void | (() => void | Promise<void>)) { const dispose = install(); if (dispose) { cleanups.push(dispose); ownedCleanups.push(dispose) } },
    on: () => () => {},
  } as never)
  return { service, settings, loader, entered, release, revision: () => revision, maximum: () => maximum,
    overrides: () => JSON.parse(value.overrides) as Record<string, boolean>, dispose: () => Promise.all(ownedCleanups.map(close => close())) }
}
const run = (service: PaimindFeaturePackService, id: string, enabled: boolean, expectedRevision: number) =>
  service.mutate({ id, enabled, expectedRevision }).then(data => ({ data, error: undefined }), error => ({ data: undefined, error }))
const microtasks = async () => { for (let index = 0; index < 100; index += 1) await Promise.resolve() }
const waitEntered = (entered: Promise<void>, first: ReturnType<typeof run>) => Promise.race([
  entered, first.then(result => { throw result.error ?? Error('mutation completed before the Loader gate') }),
])

describe('original Feature Pack mutation/reconciliation ordering, not Browser E2E', () => {
  it('finishes a failed transition and rollback before checking the next command revision', async () => {
    const f = fixture(true)
    const first = run(f.service, 'paimind:pack:operations', true, 4)
    await waitEntered(f.entered.promise, first)
    const second = run(f.service, 'paimind:capability:runtime-orbs', false, 5)
    try {
      await microtasks()
      expect(f.settings.mutate).toHaveBeenCalledTimes(1)
      expect(f.maximum()).toBe(1)
    } finally { f.release.resolve(); await Promise.all([first, second]) }
    expect((await first).error).toHaveProperty('message', 'Cannot find package @paimind/task-monitor')
    expect((await second).error).toHaveProperty('message', 'settings revision conflict')
    expect(f.overrides()).toEqual({ 'paimind:pack:operations': false })
    expect(f.revision()).toBe(6)
    const retry = await run(f.service, 'paimind:capability:runtime-orbs', false, 6)
    expect(retry.error).toBeUndefined()
    expect(f.overrides()).toEqual({ 'paimind:pack:operations': false, 'paimind:capability:runtime-orbs': false })
  })

  it('serializes successful commands without discarding the preceding persisted intent', async () => {
    const f = fixture(false)
    const first = run(f.service, 'paimind:pack:operations', true, 4)
    await waitEntered(f.entered.promise, first)
    const second = run(f.service, 'paimind:capability:runtime-orbs', false, 5)
    try { await microtasks(); expect(f.maximum()).toBe(1); expect(f.settings.mutate).toHaveBeenCalledTimes(1) }
    finally { f.release.resolve(); await Promise.all([first, second]) }
    expect((await first).error).toBeUndefined(); expect((await second).error).toBeUndefined()
    expect(f.overrides()).toEqual({ 'paimind:pack:operations': true, 'paimind:pack:content': true, 'paimind:capability:runtime-orbs': false })
    expect(f.maximum()).toBe(1)
  })

  it('queues the native boot reconciliation behind an active mutation and its rollback', async () => {
    const f = fixture(true)
    const first = run(f.service, 'paimind:pack:operations', true, 4)
    await waitEntered(f.entered.promise, first)
    try {
      await vi.advanceTimersByTimeAsync(50); await microtasks()
      expect(f.maximum()).toBe(1)
    } finally { f.release.resolve(); await first }
    await (f.service as unknown as { reconciliation: Promise<void> }).reconciliation
    const view = await f.service.describe()
    expect(view.status).toBe('ready')
    if (view.status === 'ready') expect(view.packs.find(row => row.id === 'paimind:pack:operations')?.enabled).toBe(false)
    expect(f.overrides()).toEqual({ 'paimind:pack:operations': false })
  })

  it('copies an enqueued command before a direct caller changes its object', async () => {
    const f = fixture(false), first = run(f.service, 'paimind:pack:operations', true, 4)
    await waitEntered(f.entered.promise, first)
    const request = { id: 'paimind:capability:runtime-orbs', enabled: false, expectedRevision: 5 }
    const second = f.service.mutate(request)
    request.id = 'paimind:pack:agents'; request.enabled = true; request.expectedRevision = 99
    f.release.resolve(); await first; await second
    expect(f.overrides()['paimind:capability:runtime-orbs']).toBe(false)
    expect(f.overrides()['paimind:pack:agents']).toBeUndefined()
  })

  it('does not start queued or new commands after the original controller is disposed', async () => {
    const f = fixture(false), first = run(f.service, 'paimind:pack:operations', true, 4)
    await waitEntered(f.entered.promise, first)
    const second = run(f.service, 'paimind:capability:runtime-orbs', false, 5)
    await f.dispose()
    // The public Loader call already in flight has no cancellation contract;
    // allow that existing transition to settle, without starting queued work.
    f.release.resolve(); await first
    expect((await second).error).toHaveProperty('message', 'PAIMind Feature Pack controller is disposed')
    const later = await run(f.service, 'paimind:pack:agents', false, 5)
    expect(later.error).toHaveProperty('message', 'PAIMind Feature Pack controller is disposed')
    await vi.advanceTimersByTimeAsync(100)
    expect(f.settings.mutate).toHaveBeenCalledTimes(1)
    expect(f.overrides()['paimind:capability:runtime-orbs']).toBeUndefined()
  })
})
