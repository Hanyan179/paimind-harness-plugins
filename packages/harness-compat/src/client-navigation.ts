import { markHarnessClientStyle } from './index.js'

/** Read-only projection of live footer contributions, never a product registry. */
export interface PaimindNavigationEntry {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly group: string
  readonly active: boolean
  readonly disabled: boolean
  readonly utility?: boolean
  readonly badge?: string
}

const SOURCE = 'data-paimind-navigation-source'
const FOOTER = 'data-paimind-navigation-footer'
const ACTIONS = 'data-paimind-navigation-actions'
const SETTINGS = 'data-paimind-navigation-settings'

/** Selected Harness footer seam. Keep native controls mounted and reversible. */
export function installPaimindCompactNavigation(
  mount: HTMLElement,
  publish: (entries: readonly PaimindNavigationEntry[]) => void,
): { readonly activate: (id: string) => boolean; readonly mountIcon: (id: string, container: HTMLElement) => void; readonly mountIdentity: (container: HTMLElement) => void; readonly dispose: () => void } {
  const doc = mount.ownerDocument
  const style = doc.createElement('style')
  style.textContent = `
[data-paimind-navigation-footer]{display:grid!important;grid-template-columns:minmax(0,1fr)!important;gap:0!important;align-items:center!important}
[data-paimind-navigation-footer] [data-paimind-navigation-actions]{display:contents!important}
[data-paimind-navigation-footer] [data-paimind-navigation-source]{display:none!important}
/* Keep the native settings dialog mounted; hide only its proxied trigger. */
[data-paimind-navigation-footer] [data-paimind-navigation-settings]{display:contents!important}
[data-paimind-navigation-footer]:has([data-paimind-resource-navigation][data-wide="false"]){grid-template-columns:36px!important;justify-content:center}

`
  markHarnessClientStyle(style, '@hansen/visual-experience')
  doc.head.append(style)
  const marked = new Map<HTMLElement, Map<string, string | null>>()
  let sources = new Map<string, HTMLButtonElement>()
  const utilityOpen = new Map<string, boolean>()
  let previous = ''
  let disposed = false
  const mark = (element: HTMLElement, name: string): void => {
    let attributes = marked.get(element)
    if (!attributes) { attributes = new Map(); marked.set(element, attributes) }
    if (!attributes.has(name)) attributes.set(name, element.getAttribute(name))
    if (!element.hasAttribute(name)) element.setAttribute(name, '')
  }
  const restore = (): void => {
    for (const [element, attributes] of marked) for (const [name, value] of attributes) {
      if (value === null) element.removeAttribute(name)
      else element.setAttribute(name, value)
    }
    marked.clear()
  }
  const update = (): void => {
    if (disposed) return
    const slot = mount.closest<HTMLElement>('[data-slot="sidebar.footer.action"]')
    const actions = slot?.parentElement
    const footer = actions?.parentElement
    // Only decorate the exact local slot containing this navigation mount.
    if (!slot || !actions || !footer || footer === doc.body) return
    const settings = [...footer.children].find(element => element !== actions
      && element.querySelector('[data-slot="settings.trigger"]')) as HTMLElement | undefined
    mark(footer, FOOTER)
    mark(actions, ACTIONS)
    if (settings) mark(settings, SETTINGS)
    const next = new Map<string, HTMLButtonElement>()
    const entries: PaimindNavigationEntry[] = []
    const buttons = [...slot.querySelectorAll<HTMLButtonElement>('button[data-paimind-product-trigger]')]
    for (const button of buttons) {
      const id = button.dataset.paimindProductTrigger ?? ''
      // Ambiguous identities stay as original controls instead of picking one.
      if (!id || buttons.filter(candidate => candidate.dataset.paimindProductTrigger === id).length !== 1) continue
      const label = button.dataset.paimindNavigationLabel ?? button.textContent?.trim() ?? id
      next.set(id, button)
      entries.push({ id, label: label || id,
        description: button.dataset.paimindNavigationDescription ?? '',
        group: button.dataset.paimindNavigationGroup ?? '',
        active: button.getAttribute('aria-current') === 'page', disabled: button.disabled })
      mark(button, SOURCE)
    }
    const utilities: [string, HTMLButtonElement | null][] = [
      ['notifications', slot.querySelector<HTMLButtonElement>('button[data-paimind-notification-trigger]')],
      ['settings', settings?.querySelector<HTMLButtonElement>('button:has(> [data-slot="settings.trigger"])') ?? null],
    ]
    for (const [id, button] of utilities) {
      if (!button) continue
      const active = button.getAttribute('aria-expanded') === 'true'
      if (utilityOpen.get(id) && !active) queueMicrotask(() => {
        if (disposed) return
        const focused = doc.activeElement
        if (!focused || focused === doc.body || focused === button || !focused.isConnected) {
          mount.querySelector<HTMLButtonElement>(`button[data-paimind-navigation-target="${id}"]`)?.focus()
        }
      })
      utilityOpen.set(id, active)
      next.set(id, button)
      entries.push({ id, label: button.getAttribute('aria-label') ?? button.textContent?.trim() ?? id,
        description: '', group: '', active: button.getAttribute('aria-expanded') === 'true',
        disabled: button.disabled, utility: true,
        badge: button.querySelector('[data-paimind-notification-badge]')?.textContent?.trim() ?? '' })
      mark(button, SOURCE)
    }
    for (const [element, attributes] of [...marked]) {
      if (attributes.has(SOURCE) && ![...next.values()].includes(element as HTMLButtonElement)) {
        const value = attributes.get(SOURCE)
        if (value == null) element.removeAttribute(SOURCE)
        else element.setAttribute(SOURCE, value)
        marked.delete(element)
      }
    }
    sources = next
    const signature = JSON.stringify(entries)
    if (signature !== previous) { previous = signature; publish(entries) }
  }
  const observer = new MutationObserver(update)
  observer.observe(doc.body, { childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ['aria-current', 'aria-expanded', 'aria-label', 'disabled', 'data-paimind-product-trigger',
      'data-paimind-navigation-label', 'data-paimind-navigation-description', 'data-paimind-navigation-group'] })
  update()
  return {
    activate(id) {
      update()
      const source = sources.get(id)
      if (!source?.isConnected || source.disabled) return false
      source.click()
      return true
    },
    mountIdentity(container) {
      const sidebar = mount.closest('[data-slot="sidebar"]')
      const name = sidebar?.querySelector('[data-slot="sidebar.brand.name"]')?.textContent?.trim() || 'PAIMind'
      const avatar = doc.createElement('span')
      avatar.setAttribute('data-paimind-launcher-avatar', '')
      avatar.textContent = Array.from(name).slice(0, 2).join('').toUpperCase()
      const label = doc.createElement('span')
      label.setAttribute('data-paimind-launcher-name', '')
      label.textContent = name
      container.replaceChildren(avatar, label)
    },
    mountIcon(id, container) {
      const icon = sources.get(id)?.querySelector('svg')
      container.replaceChildren(...(icon ? [icon.cloneNode(true)] : []))
    },
    dispose() { if (disposed) return; disposed = true; observer.disconnect(); restore(); style.remove(); sources.clear(); utilityOpen.clear() },
  }
}
