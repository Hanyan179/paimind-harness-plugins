import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClientContextFixture } from './client-fixture.js'
import { apply } from '../src/client/index.js'
import { FeatureManagementContributionRegistry } from '../../extension-center/src/client/contributions.js'

// Test only slot ownership here. The actual document navigation, gateway role
// checks and Browser E2E have separate suites; this is not their substitute.
vi.mock('../src/client/auth-lifecycle.js', () => ({ installAuthLifecycle: () => () => {} }))
const disposers: (() => void)[] = []
afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose()
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks()
})
const admin = { userId: 'admin-a', tenantId: 'tenant', username: 'admin', displayName: '管理员', role: 'admin', status: 'active' }
const response = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status })
const flush = async () => { for (let index = 0; index < 20; index += 1) await Promise.resolve() }

describe('governance authorization lifecycle (client behavior, not backend or Browser E2E)', () => {
  it('waits for the original Extension Center owner and removes only its own contribution across provider replacement and unload', async () => {
    vi.useFakeTimers(); vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async () => response(admin)))
    const fixture = createClientContextFixture(); disposers.push(() => fixture.disposeEffects())
    apply(fixture.context); await flush()
    const first = new FeatureManagementContributionRegistry(), next = new FeatureManagementContributionRegistry()
    fixture.setFeatureOwner(first)
    expect(first.getSnapshot().contribution?.id).toBe('enterprise-feature-management')
    fixture.setFeatureOwner()
    expect(first.getSnapshot()).toEqual({ required: true, contribution: null })
    fixture.setFeatureOwner(next)
    expect(next.getSnapshot().contribution?.id).toBe('enterprise-feature-management')
    fixture.disposeEffects()
    expect(next.getSnapshot()).toEqual({ required: true, contribution: null })
    first.dispose(); next.dispose()
  })
  it('has no governance while identity is unverified, unavailable or a member, and revokes both surfaces on every authority loss', async () => {
    vi.useFakeTimers()
    let complete!: (value: Response) => void
    const transport = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise(done => { complete = done }))
    vi.stubGlobal('fetch', transport)
    const fixture = createClientContextFixture(); disposers.push(() => fixture.disposeEffects())
    const live = () => fixture.slots.filter(row => !row.disposed()).map(row => row.options.id).sort()
    apply(fixture.context)
    expect(live()).toEqual(['paimind-enterprise-account'])
    complete(response(admin)); await flush()
    const authorized = ['paimind-enterprise-account', 'paimind-enterprise-admin', 'paimind:enterprise-admin'].sort()
    expect(live()).toEqual(authorized)
    for (const [data, status, expected] of [
      [{}, 503, ['paimind-enterprise-account']],
      [{ ...admin, role: 'member' }, 200, ['paimind-enterprise-account']],
      [admin, 200, authorized],
      [{}, 401, ['paimind-enterprise-account']],
    ] as const) {
      transport.mockImplementation(async () => response(data, status))
      await vi.advanceTimersByTimeAsync(5_000)
      expect(live()).toEqual(expected)
    }
    fixture.disposeEffects(); expect(live()).toEqual([])
    const calls = transport.mock.calls.length
    await vi.advanceTimersByTimeAsync(20_000)
    expect(transport).toHaveBeenCalledTimes(calls)
  })

  it('does not remount on an unchanged admin but discards the previous owner on account or tenant replacement', async () => {
    vi.useFakeTimers()
    let current = admin
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async () => response(current)))
    const fixture = createClientContextFixture(); disposers.push(() => fixture.disposeEffects())
    apply(fixture.context); await flush()
    const original = fixture.slots.filter(row => row.options.id !== 'paimind-enterprise-account')
    expect(original).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(fixture.slots).toHaveLength(3)
    current = { ...admin, userId: 'admin-b' }
    await vi.advanceTimersByTimeAsync(5_000)
    expect(original.every(row => row.disposed())).toBe(true)
    expect(fixture.slots.filter(row => !row.disposed())).toHaveLength(3)
    const previous = fixture.slots.filter(row => !row.disposed() && row.options.id !== 'paimind-enterprise-account')
    current = { ...current, tenantId: 'tenant-b' }
    await vi.advanceTimersByTimeAsync(5_000)
    expect(previous.every(row => row.disposed())).toBe(true)
    expect(fixture.slots.filter(row => !row.disposed())).toHaveLength(3)
  })

  it('waits for the real discovery slot and removes subscriptions on provider loss before it can return', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async () => response(admin)))
    const fixture = createClientContextFixture(); disposers.push(() => fixture.disposeEffects())
    const originalInject = fixture.context.slots.inject.bind(fixture.context.slots)
    let mount!: () => (() => void) | Iterable<() => void>
    fixture.context.slots.inject = (name, install) => {
      if (name === 'paimind.extension') mount = install
      else originalInject(name, install)
    }
    apply(fixture.context); await flush()
    const descriptors = () => fixture.slots.filter(row => row.options.name === 'paimind.extension' && !row.disposed())
    expect(descriptors()).toHaveLength(0)
    const remove = mount() as () => void; disposers.push(remove)
    expect(descriptors()).toHaveLength(1)
    remove(); expect(descriptors()).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(descriptors()).toHaveLength(0)
    disposers.push(mount() as () => void)
    expect(descriptors()).toHaveLength(1)
  })
})
