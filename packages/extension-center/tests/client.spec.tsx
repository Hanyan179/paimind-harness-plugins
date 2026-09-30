import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentType } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { contributePaimindExtension, type PaimindExtensionCenterClientContext } from '@paimind/harness-compat'
import { createClientContextFixture } from '@paimind/testkit'
import {
  apply,
  ExtensionCenterSection,
  findPaimindFeaturePackClientGaps,
} from '../src/client/index.js'

const extension = {
  id: 'paimind:runtime-orbs' as const,
  packageName: '@paimind/runtime-orbs' as const,
  category: 'experience' as const,
  nameZh: '运行状态球', nameEn: 'Runtime Orb',
  descriptionZh: '显示真实运行状态。', descriptionEn: 'Displays real runtime state.',
  surface: 'conversation' as const, maturity: 'available' as const,
}
const extensions = Object.freeze([extension])
const emptyExtensions = Object.freeze([])

const developerResourcesExtension = {
  id: 'paimind:developer-resources' as const,
  packageName: '@paimind/developer-resources' as const,
  category: 'developer' as const,
  nameZh: '开发者资源', nameEn: 'Developer Resources',
  descriptionZh: '显示运行诊断。', descriptionEn: 'Shows runtime diagnostics.',
  surface: 'settings' as const, maturity: 'available' as const,
}
const partialExtensions = Object.freeze([developerResourcesExtension])

function createExtensionRemote() {
  const remote: Record<string, unknown> = {
    pluginInventory: { list: vi.fn().mockResolvedValue({ ok: true, value: { entries: [] } }) },
  }
  remote.$mount = vi.fn().mockImplementation(async () => {
    remote.paimindFeaturePacks = {
      describe: vi.fn().mockResolvedValue({ ok: true, value: { status: 'unavailable' } }),
      mutate: vi.fn().mockResolvedValue({ ok: true, value: { status: 'unavailable' } }),
    }
    return async () => { delete remote.paimindFeaturePacks }
  })
  return remote
}

function createExtensionContext(fixture: ReturnType<typeof createClientContextFixture>) {
  let context: Record<string, unknown>
  context = {
    ...fixture.context,
    remote: createExtensionRemote(),
    inject(_dependencies: readonly string[], install: (ctx: unknown) => void) {
      install(context)
      return Object.assign(Promise.resolve(), {
        dispose: async () => { fixture.disposeEffects() },
      })
    },
  }
  return context
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('Extension Center client boot settling', () => {
  async function setup(recoveryAttempted: boolean) {
    vi.useFakeTimers()
    const storage = window.sessionStorage
    const key = 'paimind:feature-pack-client-recovery-v1'
    const previous = storage.getItem(key)
    if (recoveryAttempted) storage.setItem(key, 'attempted')
    else storage.removeItem(key)
    const reload = vi.fn()
    vi.stubGlobal('window', { sessionStorage: storage, location: { reload } })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fixture = createClientContextFixture()
    const context = createExtensionContext(fixture)
    const dispose = await apply(context as never)
    const remote = context.remote as ReturnType<typeof createExtensionRemote>
    const inventory = remote.pluginInventory as { list: ReturnType<typeof vi.fn> }
    inventory.list.mockResolvedValue({ ok: true, value: { entries: [{
      entryId: 'agent-market', moduleName: '@paimind/agent-market', enabled: true, fiberPhase: 'active',
    }] } })
    const packs = remote.paimindFeaturePacks as { describe: ReturnType<typeof vi.fn> }
    packs.describe.mockResolvedValue({ ok: true, value: { status: 'ready', revision: 1, writable: true, packs: [{
      id: 'paimind:pack:agents', loaderEntryId: 'paimind-pack-agents', nameZh: '智能体中心', nameEn: 'Agent Center',
      descriptionZh: '智能体能力。', descriptionEn: 'Agent capabilities.', order: 20,
      defaultEnabled: true, requiredPackIds: [], packageNames: ['@paimind/agent-market'],
      installed: true, desiredEnabled: true, enabled: true, capabilities: [],
    }] } })
    return {
      reload, error, inventory, packs,
      contribute: () => contributePaimindExtension(fixture.context.slots, {
        ...extension, id: 'paimind:agent-market', packageName: '@paimind/agent-market',
      }),
      async close() {
        await dispose(); fixture.disposeEffects(); error.mockRestore()
        if (previous === null) storage.removeItem(key)
        else storage.setItem(key, previous)
      },
    }
  }

  it.each([false, true])('waits for a late client contribution before recovery (prior recovery: %s)', async attempted => {
    const fixture = await setup(attempted)
    try {
      await vi.advanceTimersByTimeAsync(250)
      expect(document.documentElement.getAttribute('data-paimind-boot-consistency')).toBe('checking')
      expect(fixture.reload).not.toHaveBeenCalled()
      expect(fixture.error).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1750)
      fixture.contribute()
      await vi.advanceTimersByTimeAsync(250)
      expect(document.documentElement.getAttribute('data-paimind-boot-consistency')).toBe('ready')
      expect(window.sessionStorage.getItem('paimind:feature-pack-client-recovery-v1')).toBeNull()
      await vi.advanceTimersByTimeAsync(6000)
      expect(fixture.reload).not.toHaveBeenCalled()
      expect(fixture.error).not.toHaveBeenCalled()
    } finally { await fixture.close() }
  })

  it.each([false, true])('keeps persistent client gaps bounded (prior recovery: %s)', async attempted => {
    const fixture = await setup(attempted)
    try {
      await vi.advanceTimersByTimeAsync(4750)
      expect(document.documentElement.getAttribute('data-paimind-boot-consistency')).toBe('checking')
      expect(fixture.reload).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(250)
      expect(document.documentElement.getAttribute('data-paimind-boot-consistency')).toBe(attempted ? 'failed' : 'reloading')
      expect(fixture.reload).toHaveBeenCalledTimes(attempted ? 0 : 1)
      if (attempted) expect(fixture.error).toHaveBeenCalledWith(
        '[paimind-extension-center] Client Feature Pack recovery remained incomplete', ['paimind:pack:agents'],
      )
      const calls = fixture.inventory.list.mock.calls.length
      await vi.advanceTimersByTimeAsync(10000)
      expect(fixture.inventory.list).toHaveBeenCalledTimes(calls)
      expect(fixture.reload).toHaveBeenCalledTimes(attempted ? 0 : 1)
    } finally { await fixture.close() }
  })

  it('disposes a pending client readiness check without a late reload or failure', async () => {
    const fixture = await setup(false)
    await vi.advanceTimersByTimeAsync(250)
    await fixture.close()
    await vi.advanceTimersByTimeAsync(10000)
    expect(document.documentElement.hasAttribute('data-paimind-boot-consistency')).toBe(false)
    expect(fixture.reload).not.toHaveBeenCalled()
  })
})

describe('Extension Center client contribution', () => {
  it.each([
    { metadata: { schemaVersion: 1, audience: 'member' }, role: 'status', text: '企业扩展由管理员管理', state: 'not-applicable' },
    { metadata: { schemaVersion: 2, audience: 'member' }, role: 'alert', text: '无法确认扩展管理界面配置', state: 'invalid-presentation' },
  ])('does not mount, prefetch or retry management for $state and preserves the discovery slot owner', async ({ metadata, role, text, state }) => {
    vi.useFakeTimers()
    vi.stubGlobal('__PAIMIND_CLIENT_AUDIENCE__', metadata)
    const fixture = createClientContextFixture()
    const context = createExtensionContext(fixture) as PaimindExtensionCenterClientContext
    const remote = (context as unknown as { remote: ReturnType<typeof createExtensionRemote> }).remote
    const attribute = 'data-paimind-boot-consistency'
    const previous = document.documentElement.getAttribute(attribute)
    document.documentElement.setAttribute(attribute, 'bootstrap')
    let dispose: (() => Promise<void>) | undefined
    try {
      dispose = await apply(context as never)
      const entry = fixture.slots.find(row => row.options.id === 'paimind-extensions')!
      expect(entry.options.children).toEqual({ 'paimind.extension': { kind: 'list', scope: 'root' } })
      const Settings = entry.component as ComponentType
      render(<Settings />)
      expect(screen.getByRole(role)).toHaveTextContent(text)
      expect(screen.queryByRole('switch')).toBeNull()
      expect(fixture.slots.some(row => row.options.id === 'paimind:extension-center')).toBe(false)
      await vi.advanceTimersByTimeAsync(6000)
      expect(remote.$mount).not.toHaveBeenCalled()
      expect((remote.pluginInventory as { list: unknown }).list).not.toHaveBeenCalled()
      expect(remote.paimindFeaturePacks).toBeUndefined()
      expect(document.documentElement.getAttribute(attribute)).toBe(state)
      await dispose()
      expect(fixture.slots.every(row => row.disposed())).toBe(true)
      expect(document.getElementById('@paimind/extension-center')).toBeNull()
      expect(document.documentElement.getAttribute(attribute)).toBe('bootstrap')
    } finally {
      await dispose?.(); fixture.disposeEffects()
      if (previous === null) document.documentElement.removeAttribute(attribute)
      else document.documentElement.setAttribute(attribute, previous)
    }
  })
  it('detects an active Host Pack whose sentinel Client contribution missed fresh boot', () => {
    const view = {
      status: 'ready' as const, revision: 1, writable: true,
      packs: [{
        id: 'paimind:pack:agents' as const, loaderEntryId: 'paimind-pack-agents' as const,
        nameZh: '智能体中心', nameEn: 'Agent Center',
        descriptionZh: '智能体能力。', descriptionEn: 'Agent capabilities.',
        order: 20, defaultEnabled: true, requiredPackIds: [],
        packageNames: ['@paimind/agent-market' as const],
        installed: true, desiredEnabled: true, enabled: true, capabilities: [],
      }],
    }
    const inventory = { entries: [{
      entryId: 'agent-market', moduleName: '@paimind/agent-market',
      enabled: true, fiberPhase: 'active',
    }] }
    expect(findPaimindFeaturePackClientGaps(view, inventory, emptyExtensions)).toEqual([
      'paimind:pack:agents',
    ])
    expect(findPaimindFeaturePackClientGaps(view, inventory, [{
      ...extension,
      id: 'paimind:agent-market',
      packageName: '@paimind/agent-market',
    }])).toEqual([])
    expect(findPaimindFeaturePackClientGaps({
      ...view,
      packs: [{ ...view.packs[0], enabled: false, failure: 'Cannot find package @paimind/agent-market' }],
    }, inventory, emptyExtensions)).toEqual([])
  })

  it('registers an independent Settings section and its own product descriptor', async () => {
    document.getElementById('@paimind/extension-center')?.remove()
    const fixture = createClientContextFixture()
    const context = createExtensionContext(fixture) as PaimindExtensionCenterClientContext
    const dispose = await apply(context as never)
    expect(fixture.slots.find(entry => entry.injectedName === 'settings.section')).toMatchObject({
      options: { id: 'paimind-extensions', order: 17 },
    })
    expect(fixture.slots.find(entry => entry.injectedName === 'paimind.extension')).toMatchObject({
      options: { id: 'paimind:extension-center' },
    })
    expect(document.getElementById('@paimind/extension-center')).not.toBeNull()
    await dispose()
    fixture.disposeEffects()
    expect(document.getElementById('@paimind/extension-center')).toBeNull()
    expect(fixture.slots.every(entry => entry.disposed())).toBe(true)
  })

  it('presents product packs first and toggles the Runtime Orb capability through the Host contract', async () => {
    const ready = {
      status: 'ready' as const, revision: 7, writable: true,
      packs: [{
        id: 'paimind:pack:experience' as const, loaderEntryId: 'paimind-pack-experience' as const,
        nameZh: '产品体验', nameEn: 'Product Experience',
        descriptionZh: '产品体验能力。', descriptionEn: 'Product experience capabilities.',
        order: 10, defaultEnabled: true, requiredPackIds: [],
        packageNames: ['@paimind/runtime-orbs' as const], installed: true, enabled: true,
        capabilities: [{
          id: 'paimind:capability:runtime-orbs' as const,
          loaderEntryId: 'paimind-capability-runtime-orbs' as const,
          packageNames: ['@paimind/runtime-orbs' as const],
          nameZh: '动态状态球', nameEn: 'Runtime Orbs',
          descriptionZh: '显示真实运行状态。', descriptionEn: 'Shows real runtime state.',
          defaultEnabled: true, installed: true, enabled: true,
        }],
      }],
    }
    const mutateFeaturePack = vi.fn().mockResolvedValue({
      ...ready,
      revision: 8,
      packs: [{ ...ready.packs[0], capabilities: [{ ...ready.packs[0].capabilities[0], enabled: false }] }],
    })
    const listInventory = vi.fn().mockResolvedValue({ entries: [] })
    const reloadApplication = vi.fn()
    render(<ExtensionCenterSection
      close={() => {}}
      locale={{ getLocale: () => ({ active: 'zh-CN' }), subscribe: () => () => {} }}
      getExtensions={() => extensions}
      subscribeExtensions={() => () => {}}
      listInventory={listInventory}
      describeFeaturePacks={async () => ready}
      mutateFeaturePack={mutateFeaturePack}
      reloadApplication={reloadApplication}
    />)
    fireEvent.click(await screen.findByRole('button', { name: '打开 产品体验' }))
    const orbSwitch = await screen.findByRole('switch', { name: /动态状态球 · 已启用/ })
    fireEvent.click(orbSwitch)
    await waitFor(() => expect(mutateFeaturePack).toHaveBeenCalledWith({
      id: 'paimind:capability:runtime-orbs', enabled: false, expectedRevision: 7,
    }))
    await waitFor(() => expect(screen.getByRole('switch', { name: /动态状态球 · 已关闭/ })).toHaveAttribute('aria-checked', 'false'))
    await waitFor(() => expect(listInventory).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(reloadApplication).toHaveBeenCalledOnce())
  })

  it('treats an intentionally disabled capability as healthy rather than a partial Pack failure', async () => {
    const ready = {
      status: 'ready' as const, revision: 8, writable: true,
      packs: [{
        id: 'paimind:pack:experience' as const, loaderEntryId: 'paimind-pack-experience' as const,
        nameZh: '产品体验', nameEn: 'Product Experience',
        descriptionZh: '产品体验能力。', descriptionEn: 'Product experience capabilities.',
        order: 10, defaultEnabled: true, requiredPackIds: [],
        packageNames: ['@paimind/runtime-orbs' as const], installed: true, enabled: true,
        capabilities: [{
          id: 'paimind:capability:runtime-orbs' as const,
          loaderEntryId: 'paimind-capability-runtime-orbs' as const,
          packageNames: ['@paimind/runtime-orbs' as const],
          nameZh: '动态状态球', nameEn: 'Runtime Orbs',
          descriptionZh: '显示真实运行状态。', descriptionEn: 'Shows real runtime state.',
          defaultEnabled: true, installed: true, enabled: false,
        }],
      }],
    }
    render(<ExtensionCenterSection
      close={() => {}}
      locale={{ getLocale: () => ({ active: 'zh-CN' }), subscribe: () => () => {} }}
      getExtensions={() => emptyExtensions}
      subscribeExtensions={() => () => {}}
      listInventory={async () => ({ entries: [] })}
      describeFeaturePacks={async () => ready}
      mutateFeaturePack={async () => ready}
    />)
    expect(await screen.findByText('运行中')).toBeInTheDocument()
    expect(screen.queryByText('部分运行')).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: '打开 产品体验' }))
    await screen.findByRole('switch', { name: /动态状态球 · 已关闭/ })
  })

  it('shows an enabled Product Pack as partial when one internal module is absent', async () => {
    const ready = {
      status: 'ready' as const, revision: 9, writable: true,
      packs: [{
        id: 'paimind:pack:operations' as const, loaderEntryId: 'paimind-pack-operations' as const,
        nameZh: '工作运营', nameEn: 'Work Operations',
        descriptionZh: '工作运营能力。', descriptionEn: 'Work operations capabilities.',
        order: 60, defaultEnabled: true, requiredPackIds: ['paimind:pack:content' as const],
        packageNames: ['@paimind/task-monitor' as const, '@paimind/developer-resources' as const],
        installed: true, enabled: true, capabilities: [],
      }],
    }
    render(<ExtensionCenterSection
      close={() => {}}
      locale={{ getLocale: () => ({ active: 'zh-CN' }), subscribe: () => () => {} }}
      getExtensions={() => partialExtensions}
      subscribeExtensions={() => () => {}}
      listInventory={async () => ({ entries: [{
        entryId: 'developer-resources', moduleName: '@paimind/developer-resources',
        enabled: true, fiberPhase: 'active',
      }] })}
      describeFeaturePacks={async () => ready}
      mutateFeaturePack={async () => ready}
    />)
    await waitFor(() => expect(screen.getByText('1 / 2 个扩展')).toBeInTheDocument())
    expect(screen.getByText('部分运行')).toBeInTheDocument()
  })

  it('shows desired-on Loader failure as failed instead of disabled or running', async () => {
    const ready = {
      status: 'ready' as const, revision: 10, writable: true,
      packs: [{
        id: 'paimind:pack:proposal' as const, loaderEntryId: 'paimind-pack-proposal' as const,
        nameZh: '提案与演示', nameEn: 'Proposal & Presentation',
        descriptionZh: '提案能力。', descriptionEn: 'Proposal capabilities.',
        order: 40, defaultEnabled: true, requiredPackIds: ['paimind:pack:content' as const],
        packageNames: ['@paimind/proposal-experience' as const], installed: true,
        desiredEnabled: true, enabled: false,
        failure: 'Cannot find package @paimind/proposal-experience',
        capabilities: [],
      }],
    }
    render(<ExtensionCenterSection
      close={() => {}}
      locale={{ getLocale: () => ({ active: 'zh-CN' }), subscribe: () => () => {} }}
      getExtensions={() => emptyExtensions}
      subscribeExtensions={() => () => {}}
      listInventory={async () => ({ entries: [] })}
      describeFeaturePacks={async () => ready}
      mutateFeaturePack={async () => ready}
    />)
    const failedSwitch = await screen.findByRole('switch', { name: '提案与演示 · 启用失败' })
    expect(failedSwitch).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('启动失败')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Cannot find package @paimind/proposal-experience')
    expect(screen.queryByText('运行中')).not.toBeInTheDocument()
  })

  it('opens a Feature Pack and shows its individual extension system state', async () => {
    const locale = { getLocale: () => ({ active: 'zh-CN' }), subscribe: () => () => {} }
    const ready = {
      status: 'ready' as const, revision: 1, writable: true,
      packs: [{
        id: 'paimind:pack:experience' as const, loaderEntryId: 'paimind-pack-experience' as const,
        nameZh: '产品体验', nameEn: 'Product Experience',
        descriptionZh: '产品体验能力。', descriptionEn: 'Product experience capabilities.',
        order: 10, defaultEnabled: true, requiredPackIds: [],
        packageNames: ['@paimind/runtime-orbs' as const], installed: true, enabled: true, capabilities: [],
      }],
    }
    render(<ExtensionCenterSection
      close={() => {}}
      locale={locale}
      getExtensions={() => extensions}
      subscribeExtensions={() => () => {}}
      listInventory={async () => ({ entries: [{ entryId: 'orb', moduleName: '@paimind/runtime-orbs', enabled: true, fiberPhase: 'active' }] })}
      describeFeaturePacks={async () => ready}
      mutateFeaturePack={async () => ready}
    />)
    fireEvent.click(await screen.findByRole('button', { name: '打开 产品体验' }))
    expect(await screen.findByText('已加载')).toBeInTheDocument()
    expect(screen.getByText('运行状态球')).toBeInTheDocument()
    expect(screen.getByText('@paimind/runtime-orbs')).toBeInTheDocument()
    expect(screen.queryByText('使用与配置')).not.toBeInTheDocument()
    expect(screen.queryByText('入口类型')).not.toBeInTheDocument()
  })

  it('searches bilingual metadata and package identity without inventing marketplace facts', async () => {
    const ready = {
      status: 'ready' as const, revision: 1, writable: true,
      packs: [{
        id: 'paimind:pack:experience' as const, loaderEntryId: 'paimind-pack-experience' as const,
        nameZh: '产品体验', nameEn: 'Product Experience', descriptionZh: '产品体验能力。', descriptionEn: 'Product experience capabilities.',
        order: 10, defaultEnabled: true, requiredPackIds: [], packageNames: ['@paimind/runtime-orbs' as const], installed: true, enabled: true, capabilities: [],
      }],
    }
    render(<ExtensionCenterSection
      close={() => {}}
      locale={{ getLocale: () => ({ active: 'en-US' }), subscribe: () => () => {} }}
      getExtensions={() => extensions}
      subscribeExtensions={() => () => {}}
      listInventory={async () => ({ entries: [] })}
      describeFeaturePacks={async () => ready}
    />)
    const search = await screen.findByRole('searchbox', { name: 'Search packs or extensions' })
    fireEvent.change(search, { target: { value: '@paimind/runtime-orbs' } })
    expect(screen.getByText('Product Experience')).toBeInTheDocument()
    fireEvent.change(search, { target: { value: 'no-such-marketplace-rating' } })
    expect(screen.getByText('No matching Feature Packs.')).toBeInTheDocument()
    expect(screen.queryByText(/rating|download|verified|update/i)).not.toBeInTheDocument()
  })

  it('does not show stale technical truth when Harness inventory fails and can retry', async () => {
    const ready = {
      status: 'ready' as const, revision: 1, writable: true,
      packs: [{
        id: 'paimind:pack:experience' as const, loaderEntryId: 'paimind-pack-experience' as const,
        nameZh: '产品体验', nameEn: 'Product Experience', descriptionZh: '产品体验能力。', descriptionEn: 'Product experience capabilities.',
        order: 10, defaultEnabled: true, requiredPackIds: [], packageNames: ['@paimind/runtime-orbs' as const], installed: true, enabled: true, capabilities: [],
      }],
    }
    const listInventory = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ entries: [{ entryId: 'orb', moduleName: '@paimind/runtime-orbs', enabled: true, fiberPhase: 'active' }] })
    render(<ExtensionCenterSection
      close={() => {}}
      locale={{ getLocale: () => ({ active: 'en-US' }), subscribe: () => () => {} }}
      getExtensions={() => extensions}
      subscribeExtensions={() => () => {}}
      listInventory={listInventory}
      describeFeaturePacks={async () => ready}
    />)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('temporarily unavailable'))
    expect(screen.queryByText('Active')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Open Product Experience' }))
    await waitFor(() => expect(screen.getByText('Active')).toBeInTheDocument())
    expect(listInventory).toHaveBeenCalledTimes(2)
  })

  it('contains loading state without rendering guessed technical status', () => {
    const ready = {
      status: 'ready' as const, revision: 1, writable: true,
      packs: [{
        id: 'paimind:pack:experience' as const, loaderEntryId: 'paimind-pack-experience' as const,
        nameZh: '产品体验', nameEn: 'Product Experience', descriptionZh: '产品体验能力。', descriptionEn: 'Product experience capabilities.',
        order: 10, defaultEnabled: true, requiredPackIds: [], packageNames: ['@paimind/runtime-orbs' as const], installed: true, enabled: true, capabilities: [],
      }],
    }
    render(<ExtensionCenterSection
      close={() => {}}
      locale={{ getLocale: () => ({ active: 'en-US' }), subscribe: () => () => {} }}
      getExtensions={() => extensions}
      subscribeExtensions={() => () => {}}
      listInventory={async () => await new Promise(() => {})}
      describeFeaturePacks={async () => ready}
    />)
    expect(screen.getByText('Syncing extension status…')).toBeInTheDocument()
    expect(screen.queryByText('Active')).not.toBeInTheDocument()
  })

  it('omits a malformed extension contribution so sibling plugins keep working', async () => {
    const fixture = createClientContextFixture()
    const context = createExtensionContext(fixture) as PaimindExtensionCenterClientContext
    const dispose = await apply(context as never)
    const malformed = { id: 'paimind:malformed', packageName: '@paimind/malformed', category: 'unknown' }
    fixture.context.slots.register({
      name: 'paimind.extension',
      id: 'malformed-extension',
      inject: () => ({ descriptor: malformed }),
    }, () => null)
    const settings = fixture.slots.find(entry => entry.injectedName === 'settings.section')
    const SettingsComponent = settings?.component as ComponentType<Record<string, unknown>>
    const injected = settings?.inject?.() as Record<string, unknown>
    render(<><button type="button">Sibling plugin</button><SettingsComponent {...injected} close={() => {}} /></>)
    await waitFor(() => expect(screen.getByText('扩展中心')).toBeInTheDocument())
    expect(screen.queryByText('paimind:malformed')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sibling plugin' }))
    expect(screen.getByRole('button', { name: 'Sibling plugin' })).toBeEnabled()
    await dispose()
    fixture.disposeEffects()
  })
})
