import { afterEach, describe, expect, it, vi } from 'vitest'
import { installHarnessSettingsResponsiveLayout, type HarnessInspectableSlotRegistry } from '../src/index.js'

const cleanup: (() => void)[] = []
afterEach(() => { for (const dispose of cleanup.splice(0).reverse()) dispose(); document.body.innerHTML = ''; document.head.innerHTML = '' })
const marker = 'data-paimind-native-settings-layout'
function setup() {
  let entries = [{ options: { id: 'enterprise-account', label: () => '企业账户' } }]
  const listeners = new Set<() => void>()
  const unsubscribe = vi.fn()
  const slots: HarnessInspectableSlotRegistry = {
    entries: () => entries, getVersion: () => 1,
    subscribe: (_name, listener) => { listeners.add(listener); return () => { unsubscribe(); listeners.delete(listener) } },
    inject: () => {}, register: () => () => {},
  }
  const removeSection = () => { entries = []; for (const listener of listeners) listener() }
  return { slots, unsubscribe, removeSection }
}
function shell() {
  const dialog = document.createElement('div')
  dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true')
  dialog.innerHTML = '<nav><div>设置</div><div><button>通用设置</button><button>企业账户</button></div></nav><div><div><button>关闭</button></div><div>原生内容</div></div>'
  document.body.append(dialog)
  return dialog
}
const flush = async () => { await new Promise(done => setTimeout(done, 0)) }

describe('native Settings responsive geometry (DOM contract, not visual acceptance)', () => {
  it('only marks the live native shell; keeps existing nodes, attributes and listeners, then fully restores', () => {
    const { slots, unsubscribe } = setup()
    const dialog = shell(); const original = dialog.innerHTML
    const action = dialog.querySelector('button')!; const clicked = vi.fn(); action.addEventListener('click', clicked)
    const dispose = installHarnessSettingsResponsiveLayout(slots, 'enterprise-account')
    cleanup.push(dispose)
    expect(dialog.hasAttribute(marker)).toBe(true)
    const style = document.head.querySelector('style')!
    expect(style.textContent).toContain('@media(max-width:600px)')
    expect(style.textContent).toContain("body:not([data-paimind-experience='paimind'])")
    expect(style.textContent).not.toContain('VOzbGW')
    expect(dialog.innerHTML).toBe(original)
    action.click(); expect(clicked).toHaveBeenCalledOnce()
    dispose()
    expect(dialog.hasAttribute(marker)).toBe(false); expect(style.isConnected).toBe(false)
    expect(dialog.innerHTML).toBe(original); expect(unsubscribe).toHaveBeenCalled()
  })

  it('acquires a newly opened shell and releases it when the native section provider disappears', async () => {
    const { slots, removeSection } = setup()
    cleanup.push(installHarnessSettingsResponsiveLayout(slots, 'enterprise-account'))
    expect(document.head.querySelector('style')).toBeNull()
    const dialog = shell(); await flush()
    expect(dialog.hasAttribute(marker)).toBe(true)
    removeSection()
    expect(dialog.hasAttribute(marker)).toBe(false)
    expect(document.head.querySelector('style')).toBeNull()
  })

  it('refuses ambiguous dialogs and structurally changed native shells, without changing unrelated pages', async () => {
    const { slots } = setup(); const first = shell(); const second = shell()
    cleanup.push(installHarnessSettingsResponsiveLayout(slots, 'enterprise-account'))
    expect(first.hasAttribute(marker)).toBe(false); expect(second.hasAttribute(marker)).toBe(false)
    second.remove(); await flush(); expect(first.hasAttribute(marker)).toBe(true)
    first.querySelector('nav')!.append(document.createElement('div')); await flush()
    expect(first.hasAttribute(marker)).toBe(false); expect(document.head.querySelector('style')).toBeNull()
  })

  it('does not replace a foreign marker or take ownership of unknown modals', () => {
    const { slots } = setup(); const dialog = shell(); dialog.setAttribute(marker, 'other-owner')
    const dispose = installHarnessSettingsResponsiveLayout(slots, 'enterprise-account'); cleanup.push(dispose)
    expect(document.head.querySelector('style')).toBeNull(); dispose()
    expect(dialog.getAttribute(marker)).toBe('other-owner')
    expect(document.querySelectorAll('nav')).toHaveLength(1)
  })

  it('fails safely when the inspection provider or contributed id is unavailable', () => {
    const { slots } = setup(); const dialog = shell()
    cleanup.push(installHarnessSettingsResponsiveLayout(slots, 'missing'))
    cleanup.push(installHarnessSettingsResponsiveLayout({ inject: () => {}, register: () => () => {} }, 'enterprise-account'))
    expect(dialog.hasAttribute(marker)).toBe(false); expect(document.head.querySelector('style')).toBeNull()
  })
})
