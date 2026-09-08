import { describe, expect, it, vi } from 'vitest'
import {
  PAIMIND_FEATURE_PACKS,
  decodePaimindFeatureOverrides,
  featureToggleEnabled,
} from '../src/feature-packs.js'
import {
  PaimindFeaturePackService,
  resolvePaimindFeatureToggleOverrides,
} from '../src/index.js'

describe('Product Feature Pack composition', () => {
  it('projects runtime packages without duplicate ownership through six product-facing packs beside the control plane', () => {
    const packageNames = PAIMIND_FEATURE_PACKS.flatMap(pack => pack.packageNames)
    expect(PAIMIND_FEATURE_PACKS.map(pack => pack.id)).toEqual([
      'paimind:pack:experience', 'paimind:pack:agents', 'paimind:pack:content',
      'paimind:pack:proposal', 'paimind:pack:automation', 'paimind:pack:operations',
    ])
    expect(new Set(packageNames).size).toBe(packageNames.length)
    expect(PAIMIND_FEATURE_PACKS.find(pack => pack.id === 'paimind:pack:agents')?.packageNames).toContain('@hansen/mcp-center')
    expect(PAIMIND_FEATURE_PACKS[0]?.capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'paimind:capability:runtime-orbs',
        loaderEntryId: 'paimind-capability-runtime-orbs',
        packageNames: ['@hansen/runtime-orbs'],
      }),
    ]))
  })

  it('keeps unknown persisted keys inert and uses explicit defaults', () => {
    const overrides = decodePaimindFeatureOverrides(JSON.stringify({
      'paimind:pack:experience': false,
      'paimind:capability:runtime-orbs': false,
      'paimind:pack:retired': true,
      malformed: 'yes',
    }))
    expect(overrides).toEqual({
      'paimind:pack:experience': false,
      'paimind:capability:runtime-orbs': false,
    })
    expect(featureToggleEnabled('paimind:pack:experience', overrides)).toBe(false)
    expect(featureToggleEnabled('paimind:pack:agents', overrides)).toBe(true)
  })

  it('enables prerequisites and disables dependents as one product-safe change', () => {
    const enabled = resolvePaimindFeatureToggleOverrides(
      'paimind:pack:proposal', true,
      { 'paimind:pack:content': false },
    )
    expect(enabled['paimind:pack:proposal']).toBe(true)
    expect(enabled['paimind:pack:content']).toBe(true)

    const disabled = resolvePaimindFeatureToggleOverrides(
      'paimind:pack:content', false,
      {},
    )
    expect(disabled['paimind:pack:proposal']).toBe(false)
    expect(disabled['paimind:pack:automation']).toBe(false)
    expect(disabled['paimind:pack:operations']).toBe(false)
  })

  it('rolls a partially applied Loader change back when one Product Pack fails to start', async () => {
    const overrides = { 'paimind:pack:operations': false }
    const settingsValue = { overrides: JSON.stringify(overrides) }
    let settingsRevision = 4
    let registeredNamespace: unknown
    const settingsMutate = vi.fn(async (
      _namespace: unknown,
      operations: readonly { readonly op: string; readonly path: readonly string[]; readonly value?: unknown }[],
      expectedRevision: number,
    ) => {
      expect(expectedRevision).toBe(settingsRevision)
      const operation = operations[0]
      if (operation?.op === 'set' && operation.path[0] === 'overrides' && typeof operation.value === 'string') {
        settingsValue.overrides = operation.value
      }
      settingsRevision += 1
    })
    const settings = {
      writable: true,
      register(namespace: unknown) {
        registeredNamespace = namespace
        return {
          get: () => settingsValue,
          watch: () => () => {},
          update: async () => {},
          replace: async () => {},
        }
      },
      describe: () => [{ ns: registeredNamespace, value: settingsValue, revision: settingsRevision }],
      mutate: settingsMutate,
    }
    const entries = new Map(PAIMIND_FEATURE_PACKS.flatMap(pack => [
      [pack.loaderEntryId, { id: pack.loaderEntryId, options: {
        id: pack.loaderEntryId, name: 'cordis:group', group: true,
        ...(pack.id === 'paimind:pack:operations' ? { disabled: true } : {}),
      } }],
      ...pack.capabilities.map(capability => [capability.loaderEntryId, {
        id: capability.loaderEntryId,
        options: { id: capability.loaderEntryId, name: 'cordis:group', group: true },
      }]),
    ] as const))
    let failOperationsStart = true
    const loader = {
      entries: () => entries.values(),
      await: async () => {},
      resolve(id: string) {
        const entry = entries.get(id)
        if (entry === undefined) throw new Error(`missing ${id}`)
        return entry
      },
      update: vi.fn(async (id: string, options: { disabled?: boolean | null }) => {
        const entry = entries.get(id)
        if (entry === undefined) throw new Error(`missing ${id}`)
        if (id === 'paimind-pack-operations' && options.disabled !== true && failOperationsStart) {
          failOperationsStart = false
          delete entry.options.disabled
          throw new Error('Cannot find package @hansen/task-monitor')
        }
        if (options.disabled === true) entry.options.disabled = true
        else delete entry.options.disabled
      }),
    }
    const cleanups: Array<() => void | Promise<void>> = []
    const context = {
      reflect: { provide: () => {} }, get: () => undefined,
      loader, settings,
      effect(install: () => void | (() => void | Promise<void>)) {
        const cleanup = install()
        if (typeof cleanup === 'function') cleanups.push(cleanup)
      },
      on: () => () => {},
    }
    const service = new PaimindFeaturePackService(context as never)

    await expect(service.mutate({
      id: 'paimind:pack:operations', enabled: true, expectedRevision: 4,
    })).rejects.toThrow('Cannot find package @hansen/task-monitor')
    expect(entries.get('paimind-pack-operations')?.options.disabled).toBe(true)
    expect(settingsMutate).toHaveBeenCalledTimes(2)
    expect(settingsMutate.mock.invocationCallOrder[0]).toBeLessThan(loader.update.mock.invocationCallOrder[0]!)
    expect(settingsValue.overrides).toBe(JSON.stringify(overrides))
    expect(settingsRevision).toBe(6)
    await Promise.all(cleanups.map(async cleanup => { await cleanup() }))
  })

  it('isolates a failed shared Loader Group and replays healthy sibling Packs during boot', async () => {
    vi.useFakeTimers()
    try {
      const settingsValue = { overrides: '{}' }
      let registeredNamespace: unknown
      const settings = {
        writable: true,
        register(namespace: unknown) {
          registeredNamespace = namespace
          return {
            get: () => settingsValue,
            watch: () => () => {},
            update: async () => {},
            replace: async () => {},
          }
        },
        describe: () => [{ ns: registeredNamespace, value: settingsValue, revision: 0 }],
        mutate: async () => {},
      }
      type Entry = {
        id: string
        options: { id: string; name: string; group: boolean; disabled?: boolean }
        active: boolean
      }
      const entries = new Map<string, Entry>(PAIMIND_FEATURE_PACKS.flatMap(pack => [
        [pack.loaderEntryId, {
          id: pack.loaderEntryId,
          options: { id: pack.loaderEntryId, name: 'cordis:group', group: true, disabled: true },
          active: false,
        }],
        ...pack.capabilities.map(capability => [capability.loaderEntryId, {
          id: capability.loaderEntryId,
          options: { id: capability.loaderEntryId, name: 'cordis:group', group: true, disabled: true },
          active: false,
        }]),
      ] as const))
      let proposalFailurePending = true
      const loader = {
        entries: () => entries.values(),
        await: async () => {},
        resolve(id: string) {
          const entry = entries.get(id)
          if (entry === undefined) throw new Error(`missing ${id}`)
          return entry
        },
        update: vi.fn(async (id: string, options: { disabled?: boolean | null }) => {
          const entry = entries.get(id)
          if (entry === undefined) throw new Error(`missing ${id}`)
          if (options.disabled === true) {
            entry.options.disabled = true
            entry.active = false
            return
          }
          delete entry.options.disabled
          if (id === 'paimind-pack-proposal' && proposalFailurePending) {
            proposalFailurePending = false
            for (const sibling of entries.values()) sibling.active = false
            throw new AggregateError(
              [new Error('Cannot find package @hansen/proposal-experience')],
              'failed to apply loader entry paimind-pack-proposal (cordis:group)',
            )
          }
          entry.active = true
        }),
      }
      const cleanups: Array<() => void | Promise<void>> = []
      const context = {
        reflect: { provide: () => {} }, get: () => undefined,
        loader, settings,
        effect(install: () => void | (() => void | Promise<void>)) {
          const cleanup = install()
          if (typeof cleanup === 'function') cleanups.push(cleanup)
        },
        on: () => () => {},
      }
      const service = new PaimindFeaturePackService(context as never)

      await vi.advanceTimersByTimeAsync(60)
      await (service as unknown as { reconciliation: Promise<void> }).reconciliation
      const view = await service.describe()
      expect(view.status).toBe('ready')
      if (view.status !== 'ready') throw new Error('Feature Pack view did not become ready')
      const byId = new Map(view.packs.map(pack => [pack.id, pack]))
      for (const id of ['paimind:pack:experience', 'paimind:pack:agents', 'paimind:pack:content'] as const) {
        expect(byId.get(id)).toMatchObject({ desiredEnabled: true, enabled: true })
        expect(entries.get(byId.get(id)!.loaderEntryId)?.active).toBe(true)
      }
      expect(byId.get('paimind:pack:proposal')).toMatchObject({
        desiredEnabled: true,
        enabled: false,
        failure: 'Cannot find package @hansen/proposal-experience',
      })
      expect(entries.get('paimind-pack-proposal')?.options.disabled).toBe(true)
      await Promise.all(cleanups.map(async cleanup => { await cleanup() }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores unrelated Agent entries and repairs an overlapping Root Include replay after boot', async () => {
    vi.useFakeTimers()
    try {
      const settingsValue = { overrides: '{}' }
      let registeredNamespace: unknown
      const settings = {
        writable: true,
        register(namespace: unknown) {
          registeredNamespace = namespace
          return {
            get: () => settingsValue,
            watch: () => () => {},
            update: async () => {},
            replace: async () => {},
          }
        },
        describe: () => [{ ns: registeredNamespace, value: settingsValue, revision: 0 }],
        mutate: async () => {},
      }
      type Entry = {
        id: string
        options: { id: string; name: string; group: boolean; disabled?: boolean }
        active: boolean
      }
      const entries = new Map<string, Entry>(PAIMIND_FEATURE_PACKS.flatMap(pack => [
        [pack.loaderEntryId, {
          id: pack.loaderEntryId,
          options: { id: pack.loaderEntryId, name: 'cordis:group', group: true, disabled: true },
          active: false,
        }],
        ...pack.capabilities.map(capability => [capability.loaderEntryId, {
          id: capability.loaderEntryId,
          options: { id: capability.loaderEntryId, name: 'cordis:group', group: true, disabled: true },
          active: false,
        }]),
      ] as const))
      let observePostBootMutations = false
      let agentsPackClosedAfterBoot = false
      const loader = {
        entries: () => entries.values(),
        await: vi.fn(async () => {}),
        resolve(id: string) {
          const entry = entries.get(id)
          if (entry === undefined) throw new Error(`missing ${id}`)
          return entry
        },
        update: vi.fn(async (id: string, options: { disabled?: boolean | null }) => {
          const entry = entries.get(id)
          if (entry === undefined) throw new Error(`missing ${id}`)
          if (options.disabled === true) {
            entry.options.disabled = true
            entry.active = false
            if (observePostBootMutations && id === 'paimind-pack-agents') agentsPackClosedAfterBoot = true
            return
          }
          delete entry.options.disabled
          entry.active = true
        }),
      }
      type LoaderEntryInitListener = (entry: {
        readonly options: { readonly id?: string; readonly disabled?: boolean | null }
      }) => void
      type LoaderPartialDisposeListener = (
        entry: { readonly options: { readonly id?: string; readonly disabled?: boolean | null } },
        legacyOptions: { readonly id?: string; readonly disabled?: boolean | null },
        active: boolean,
      ) => void
      let entryInitListener: LoaderEntryInitListener | undefined
      let partialDisposeListener: LoaderPartialDisposeListener | undefined
      const cleanups: Array<() => void | Promise<void>> = []
      const context = {
        reflect: { provide: () => {} }, get: () => undefined,
        loader, settings,
        effect(install: () => void | (() => void | Promise<void>)) {
          const cleanup = install()
          if (typeof cleanup === 'function') cleanups.push(cleanup)
        },
        on(name: string, listener: unknown) {
          if (name === 'loader/entry-init') entryInitListener = listener as LoaderEntryInitListener
          if (name === 'loader/partial-dispose') {
            partialDisposeListener = listener as LoaderPartialDisposeListener
          }
          return () => {}
        },
      }
      const service = new PaimindFeaturePackService(context as never)

      await vi.advanceTimersByTimeAsync(40)
      entryInitListener?.({ options: { id: 'paimind-pack-agents-child-during-boot' } })
      await vi.advanceTimersByTimeAsync(40)
      expect(loader.update).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(11)
      await (service as unknown as { reconciliation: Promise<void> }).reconciliation
      expect(loader.update).toHaveBeenCalled()
      expect(entries.get('paimind-pack-agents')).toMatchObject({ active: true })

      loader.update.mockClear()
      observePostBootMutations = true
      entryInitListener?.({ options: { id: 'agent-preset:quotation-reviewer:child' } })
      await (service as unknown as { reconciliation: Promise<void> }).reconciliation

      expect(loader.update).not.toHaveBeenCalled()
      expect(agentsPackClosedAfterBoot).toBe(false)
      expect(entries.get('paimind-pack-agents')).toMatchObject({ active: true })

      partialDisposeListener?.(
        { options: { id: 'agent-preset:quotation-reviewer:child' } },
        { id: 'agent-preset:quotation-reviewer:child' },
        true,
      )
      partialDisposeListener?.({ options: { id: 'include' } }, { id: 'include' }, false)
      await vi.advanceTimersByTimeAsync(30)
      await (service as unknown as { reconciliation: Promise<void> }).reconciliation
      expect(loader.update).not.toHaveBeenCalled()

      // The Host HMR Root Include replay can overlap applyOverrides. It must
      // still enqueue one coalesced repair after the external transaction.
      const internal = service as unknown as {
        loaderMutationDepth: number
        reconciliation: Promise<void>
      }
      internal.loaderMutationDepth = 1
      partialDisposeListener?.({ options: { id: 'include' } }, { id: 'include' }, true)
      partialDisposeListener?.({ options: { id: 'include' } }, { id: 'include' }, true)
      internal.loaderMutationDepth = 0
      await vi.advanceTimersByTimeAsync(25)
      await internal.reconciliation

      expect(loader.update).toHaveBeenCalled()
      expect(entries.get('paimind-pack-agents')).toMatchObject({ active: true })
      await Promise.all(cleanups.map(async cleanup => { await cleanup() }))
    } finally {
      vi.useRealTimers()
    }
  })
})
