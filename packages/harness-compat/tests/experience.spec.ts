import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  HarnessExperienceMarkers,
  NativeHarnessAgentChoiceBridge,
} from '../src/client-surface.js'
import {
  resolveHarnessSettingsNamespace,
  type HarnessAgentPresetApi,
  type HarnessAgentPresetSeatControl,
} from '../src/index.js'

afterEach(() => {
  document.body.innerHTML = ''
  document.body.removeAttribute('data-paimind-experience')
  document.body.removeAttribute('data-paimind-density')
})

describe('Harness experience semantic markers', () => {
  it('maps dotted PAIMind ownership to the native Settings namespace grammar', () => {
    expect(resolveHarnessSettingsNamespace('paimind.visual-experience')).toBe('paimind-visual-experience')
    expect(resolveHarnessSettingsNamespace('ui-theme')).toBe('ui-theme')
    expect(() => resolveHarnessSettingsNamespace('Invalid Namespace')).toThrow(TypeError)
  })

  it('tracks calm, focus and workbench density and disposes every annotation', async () => {
    document.body.innerHTML = `
      <div data-slot="sidebar"></div>
      <main data-phase="hero"><div data-composer-card></div></main>
    `
    const markers = new HarnessExperienceMarkers(document)
    markers.setMode('paimind')
    expect(document.body).toHaveAttribute('data-paimind-experience', 'paimind')
    expect(document.body).toHaveAttribute('data-paimind-density', 'calm')
    expect(document.querySelector('[data-phase="hero"]')).toHaveAttribute('data-paimind-hero')
    expect(document.querySelector('[data-composer-card]')).toHaveAttribute('data-paimind-composer')

    document.querySelector('[data-phase]')?.setAttribute('data-phase', 'active')
    await vi.waitFor(() => { expect(document.body).toHaveAttribute('data-paimind-density', 'focus') })

    document.body.insertAdjacentHTML('beforeend', '<aside data-dsh-better-sidebar></aside>')
    await vi.waitFor(() => { expect(document.body).toHaveAttribute('data-paimind-density', 'workbench') })

    document.body.setAttribute('data-dsh-sidebar-collapsed', '')
    await vi.waitFor(() => { expect(document.body).toHaveAttribute('data-paimind-density', 'focus') })

    markers.setMode('native')
    expect(document.body).toHaveAttribute('data-paimind-experience', 'native')
    expect(document.body).toHaveAttribute('data-paimind-density', 'calm')
    expect(document.querySelector('[data-paimind-composer]')).toBeNull()

    markers.dispose()
    expect(document.body).not.toHaveAttribute('data-paimind-experience')
    expect(document.querySelector('[data-paimind-shell]')).toBeNull()
  })
})

describe('native Harness Agent choice bridge', () => {
  it('reflects an external native seat change immediately and unsubscribes on disposal', async () => {
    let current = 'standard'
    const seatListeners = new Set<() => void>()
    const nativeSeat: HarnessAgentPresetSeatControl = {
      getSnapshot: () => ({ current, busy: false, error: null }),
      subscribe: listener => { seatListeners.add(listener); return () => { seatListeners.delete(listener) } },
      load: vi.fn(async () => {}),
      select: vi.fn(async id => { current = id }),
    }
    const api = {
      list: vi.fn(async () => ({ result: { ok: true as const, value: {
        authorable: true,
        hasDocument: true,
        presets: [
          { id: 'standard', trust: 'system' as const, isDefault: true, name: 'Standard' },
          { id: 'proposal-assistant', trust: 'user' as const, isDefault: false, name: 'Proposal Assistant' },
        ],
      } } })),
    } as unknown as HarnessAgentPresetApi
    const bridge = new NativeHarnessAgentChoiceBridge(api, nativeSeat)

    await expect(bridge.load()).resolves.toBe(true)
    current = 'proposal-assistant'
    seatListeners.forEach(listener => { listener() })
    expect(bridge.getSnapshot().current).toBe('proposal-assistant')

    bridge.dispose()
    current = 'standard'
    seatListeners.forEach(listener => { listener() })
    expect(bridge.getSnapshot().current).toBe('proposal-assistant')
    expect(seatListeners).toHaveLength(0)
  })

  it('classifies roster rows and delegates selection to the native seat', async () => {
    let current = 'standard'
    const nativeSeat: HarnessAgentPresetSeatControl = {
      getSnapshot: () => ({ current, busy: false, error: null }),
      load: vi.fn(async () => {}),
      select: vi.fn(async id => { current = id }),
    }
    const api = {
      list: vi.fn(async () => ({ result: { ok: true as const, value: {
        authorable: true,
        hasDocument: true,
        presets: [
          { id: 'standard', trust: 'system' as const, isDefault: true, name: '标准模式', description: '完整工具。' },
          { id: 'sales-assistant', trust: 'system' as const, isDefault: false, name: '销售助手', description: '处理销售材料。' },
          { id: 'broken', trust: 'system' as const, isDefault: false, broken: 'invalid' },
        ],
      } } })),
    } as unknown as HarnessAgentPresetApi
    const bridge = new NativeHarnessAgentChoiceBridge(api, nativeSeat)

    await expect(bridge.load()).resolves.toBe(true)
    expect(bridge.getSnapshot().choices).toEqual([
      expect.objectContaining({ id: 'standard', category: 'platform-mode' }),
      expect.objectContaining({ id: 'sales-assistant', category: 'recommended' }),
    ])
    await bridge.select('sales-assistant')
    expect(nativeSeat.select).toHaveBeenCalledWith('sales-assistant')
    expect(bridge.getSnapshot().current).toBe('sales-assistant')

    bridge.dispose()
  })

  it('tracks a native selector change initiated outside the visual bridge', async () => {
    let current = 'standard'
    const listeners = new Set<() => void>()
    const nativeSeat: HarnessAgentPresetSeatControl = {
      getSnapshot: () => ({ current, busy: false, error: null }),
      subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
      load: vi.fn(async () => {}),
      select: vi.fn(async id => {
        current = id
        listeners.forEach(listener => { listener() })
      }),
    }
    const api = {
      list: vi.fn(async () => ({ result: { ok: true as const, value: {
        authorable: true,
        hasDocument: true,
        presets: [
          { id: 'standard', trust: 'system' as const, isDefault: true, name: '标准模式' },
          { id: 'personal-agent', trust: 'user' as const, isDefault: false, name: '个人智能体' },
        ],
      } } })),
    } as unknown as HarnessAgentPresetApi
    const bridge = new NativeHarnessAgentChoiceBridge(api, nativeSeat)

    await expect(bridge.load()).resolves.toBe(true)
    current = 'personal-agent'
    listeners.forEach(listener => { listener() })

    expect(bridge.getSnapshot()).toMatchObject({
      status: 'ready',
      current: 'personal-agent',
      busy: false,
      error: null,
    })

    bridge.dispose()
    current = 'standard'
    listeners.forEach(listener => { listener() })
    expect(bridge.getSnapshot().current).toBe('personal-agent')
  })

  it('fails open when the roster is unavailable or cannot preserve the native current choice', async () => {
    const nativeSeat: HarnessAgentPresetSeatControl = {
      getSnapshot: () => ({ current: 'standard', busy: false, error: null }),
      load: vi.fn(async () => {}),
      select: vi.fn(),
    }
    const api = {
      list: vi.fn(async () => ({ result: { ok: true as const, value: {
        authorable: false,
        hasDocument: false,
        presets: [{ id: 'other', trust: 'system' as const, isDefault: false }],
      } } })),
    } as unknown as HarnessAgentPresetApi
    const bridge = new NativeHarnessAgentChoiceBridge(api, nativeSeat)
    await expect(bridge.load()).resolves.toBe(false)
    expect(bridge.getSnapshot().status).toBe('unavailable')
    expect(bridge.getSnapshot().choices).toHaveLength(0)
    bridge.dispose()
  })

  it('keeps the native current choice and exposes a recoverable selection failure', async () => {
    const nativeSeat: HarnessAgentPresetSeatControl = {
      getSnapshot: () => ({ current: 'standard', busy: false, error: null }),
      load: vi.fn(async () => {}),
      select: vi.fn(async () => { throw new Error('selection unavailable') }),
    }
    const api = {
      list: vi.fn(async () => ({ result: { ok: true as const, value: {
        authorable: true,
        hasDocument: true,
        presets: [
          { id: 'standard', trust: 'system' as const, isDefault: true, name: '标准模式' },
          { id: 'sales-assistant', trust: 'system' as const, isDefault: false, name: '销售助手' },
        ],
      } } })),
    } as unknown as HarnessAgentPresetApi
    const bridge = new NativeHarnessAgentChoiceBridge(api, nativeSeat)

    await expect(bridge.load()).resolves.toBe(true)
    await bridge.select('sales-assistant')
    expect(bridge.getSnapshot()).toMatchObject({
      status: 'ready',
      current: 'standard',
      busy: false,
      error: 'selection unavailable',
    })
    bridge.restore()
    expect(bridge.getSnapshot()).toMatchObject({ current: 'standard', error: null })
    bridge.dispose()
  })
})
