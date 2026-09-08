import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ResourceNavigation } from '../src/client/resource-navigation.js'
import { installPaimindCompactNavigation } from '../../harness-compat/src/client-navigation.js'
import { PaimindProductSurfaceController, isPaimindProductSurfaceAvailable, installPaimindProductSurfaceInteraction } from '../../harness-compat/src/client-surface.js'

const locale = { subscribe: () => () => {}, getLocale: () => ({ active: 'zh-CN' }) }
const definitions = [
  ['agent-center', '智能体', '助手'], ['skill-center', '技能', '能力与工具'],
  ['mcp-center', '连接', '能力与工具'], ['workspace-blueprints', '模板', '工作区'],
]
function setup(wide = true) {
  document.body.innerHTML = '<footer><div><div data-slot="sidebar.footer.action"><div id="navigation"></div></div></div><div id="settings"><button><span data-slot="settings.trigger">设置</span></button></div></footer>'
  const slot = document.querySelector('[data-slot="sidebar.footer.action"]')!
  const actions = new Map<string, ReturnType<typeof vi.fn>>()
  for (const [id, label, group] of definitions) {
    const button = document.createElement('button')
    button.dataset.paimindProductTrigger = id!
    button.dataset.paimindNavigationLabel = label!
    button.dataset.paimindNavigationGroup = group!
    button.textContent = `${label}中心`
    const action = vi.fn(); button.onclick = action; actions.set(id!, action); slot.append(button)
  }
  const view = render(<ResourceNavigation wide={wide} locale={locale as never} />, { container: document.getElementById('navigation')! })
  return { ...view, slot, actions }
}
afterEach(() => { cleanup(); document.body.innerHTML = ''; localStorage.clear(); vi.useRealTimers() })

describe('compact resource navigation', () => {
  it('shows collapsed menu labels on hover and focus, and hides them when expanded', () => {
    vi.useFakeTimers()
    localStorage.setItem('paimind.visual-experience.navigation.pinned.v1', 'mcp-center')
    const view = setup(false)
    for (const name of ['智能体', '连接', '资源库']) {
      const button = screen.getByRole('button', { name, exact: true })
      fireEvent.mouseEnter(button)
      act(() => { vi.advanceTimersByTime(300) })
      expect(screen.getByRole('tooltip')).toHaveTextContent(name)
      fireEvent.mouseLeave(button)
      expect(screen.queryByRole('tooltip')).toBeNull()
      fireEvent.focus(button)
      expect(screen.getByRole('tooltip')).toHaveTextContent(name)
      fireEvent.blur(button)
    }
    view.rerender(<ResourceNavigation wide locale={locale as never} />)
    fireEvent.mouseEnter(screen.getByRole('button', { name: '智能体', exact: true }))
    act(() => { vi.advanceTimersByTime(300) })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('compacts only the Settings trigger and preserves buttons in its nested native dialog', () => {
    const { unmount } = setup()
    const settings = document.getElementById('settings')!
    const wrapper = document.createElement('div')
    settings.append(wrapper)
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.innerHTML = '<nav><button class="native-settings-tab">通用设置</button></nav><section><button class="native-settings-action">打开配置文件</button><button class="native-settings-action">中文</button></section>'
    wrapper.append(dialog)
    const nativeStyle = document.createElement('style')
    nativeStyle.textContent = '.native-settings-tab{width:180px;height:40px}.native-settings-action{width:120px;height:32px}'
    document.head.prepend(nativeStyle)
    try {
      const trigger = settings.querySelector('button')!
      expect(getComputedStyle(trigger).width).toBe('36px')
      expect(getComputedStyle(dialog.querySelector('.native-settings-tab')!).width).toBe('180px')
      for (const button of dialog.querySelectorAll('.native-settings-action')) {
        expect(getComputedStyle(button).width).toBe('120px')
        expect(getComputedStyle(button).height).toBe('32px')
      }
      unmount()
      expect(getComputedStyle(trigger).width).not.toBe('36px')
      expect(getComputedStyle(dialog.querySelector('.native-settings-tab')!).width).toBe('180px')
    } finally { nativeStyle.remove() }
  })

  it('keeps the current page and its close guard while browsing, pinning and dismissing the library', () => {
    setup()
    const page = document.createElement('section'); document.body.append(page)
    const controller = new PaimindProductSurfaceController('skill-center')
    controller.open()
    const release = controller.blockClose()
    const dispose = installPaimindProductSurfaceInteraction(page, controller)
    fireEvent.click(screen.getByRole('button', { name: '资源库', exact: true }))
    expect(screen.getByRole('dialog', { name: '资源库' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '固定技能到侧边栏' }))
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(controller.getSnapshot().open).toBe(true)
    release(); dispose(); controller.dispose()
  })

  it('opens the original source action, searches and replaces one optional shortcut', async () => {
    const { actions } = setup()
    expect(screen.getByRole('button', { name: '智能体', exact: true })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '技能', exact: true })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '资源库', exact: true }))
    const dialog = screen.getByRole('dialog', { name: '资源库' })
    fireEvent.click(within(dialog).getByRole('button', { name: '固定技能到侧边栏' }))
    expect(screen.getByRole('button', { name: '技能', exact: true })).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: '固定连接到侧边栏' }))
    expect(screen.queryByRole('button', { name: '技能', exact: true })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '连接', exact: true })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '模板' } })
    expect(within(dialog).queryByRole('button', { name: '打开技能' })).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: '打开模板' }))
    expect(actions.get('workspace-blueprints')).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(localStorage.getItem('paimind.visual-experience.navigation.pinned.v1')).toBe('mcp-center')
    await waitFor(() => expect(isPaimindProductSurfaceAvailable('skill-center')).toBe(true))
  })

  it('discovers a newly mounted generic surface and drops it on source removal', async () => {
    const { slot } = setup()
    fireEvent.click(screen.getByRole('button', { name: '资源库', exact: true }))
    const button = document.createElement('button')
    button.dataset.paimindProductTrigger = 'future-provider'
    button.dataset.paimindNavigationLabel = '未来工具'
    button.textContent = '未来工具'; const activate = vi.fn(); button.onclick = activate
    act(() => { slot.append(button) })
    fireEvent.click(await screen.findByRole('button', { name: '固定未来工具到侧边栏' }))
    fireEvent.click(screen.getByRole('button', { name: '未来工具', exact: true }))
    expect(activate).toHaveBeenCalledOnce()
    act(() => { button.remove() })
    await waitFor(() => expect(screen.queryByRole('button', { name: '未来工具', exact: true })).not.toBeInTheDocument())
  })

  it('handles no matches, keyboard dismissal and restores original controls on unload', () => {
    const { unmount } = setup()
    fireEvent.click(screen.getByRole('button', { name: '资源库', exact: true }))
    expect(document.activeElement).toBe(screen.getByRole('searchbox'))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'no-resource' } })
    expect(screen.getByText('没有找到匹配的入口')).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '资源库', exact: true }))
    expect(document.querySelectorAll('[data-paimind-navigation-source]')).toHaveLength(4)
    unmount()
    expect(document.querySelector('[data-paimind-navigation-footer]')).toBeNull()
    expect(document.querySelector('[data-paimind-navigation-source]')).toBeNull()
    expect(document.querySelector('[data-slot="settings.trigger"]')).toHaveTextContent('设置')
    expect(document.querySelectorAll('button[data-paimind-product-trigger]')).toHaveLength(4)
  })

  it('restores focus to a visible library entry when a proxied source page closes', () => {
    vi.useFakeTimers()
    setup()
    const controller = new PaimindProductSurfaceController('skill-center')
    const source = document.querySelector<HTMLButtonElement>('[data-paimind-product-trigger="skill-center"]')!
    act(() => { controller.open(source); controller.close() })
    act(() => { vi.runAllTimers() })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '资源库', exact: true }))
    controller.dispose()
  })

  it('does not substitute a library shortcut for actual source availability', () => {
    setup()
    document.querySelector('[data-paimind-product-trigger="mcp-center"]')!.remove()
    expect(isPaimindProductSurfaceAvailable('mcp-center')).toBe(false)
  })

  it('rejects ambiguous source ids and does not invoke a removed source', () => {
    const { slot, unmount, actions } = setup(); unmount()
    const host = document.createElement('div'); slot.append(host)
    const source = slot.querySelector('[data-paimind-product-trigger="skill-center"]')!
    slot.append(source.cloneNode(true))
    const publish = vi.fn(); const bridge = installPaimindCompactNavigation(host, publish)
    expect(bridge.activate('skill-center')).toBe(false)
    slot.querySelector('[data-paimind-product-trigger="agent-center"]')!.remove()
    expect(bridge.activate('agent-center')).toBe(false)
    expect(actions.get('agent-center')).not.toHaveBeenCalled()
    bridge.dispose()
  })
})
