/** Read-only projection of live footer contributions, never a product registry. */
export interface PaimindNavigationEntry {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly group: string
  readonly active: boolean
  readonly disabled: boolean
}

const SOURCE = 'data-paimind-navigation-source'
const FOOTER = 'data-paimind-navigation-footer'
const ACTIONS = 'data-paimind-navigation-actions'
const SETTINGS = 'data-paimind-navigation-settings'

/** Selected Harness footer seam. Keep native controls mounted and reversible. */
export function installPaimindCompactNavigation(
  mount: HTMLElement,
  publish: (entries: readonly PaimindNavigationEntry[]) => void,
): { readonly activate: (id: string) => boolean; readonly dispose: () => void } {
  const doc = mount.ownerDocument
  const style = doc.createElement('style')
  style.textContent = `
[data-paimind-navigation-footer]{display:grid!important;grid-template-columns:minmax(0,1fr) 36px;gap:4px!important;align-items:center!important}
[data-paimind-navigation-footer] [data-paimind-navigation-actions]{display:contents!important}
[data-paimind-navigation-footer] [data-paimind-navigation-source]{display:none!important}
[data-paimind-navigation-footer] [data-paimind-navigation-settings]{grid-column:2;grid-row:2;width:36px!important;padding:0!important;margin:0!important}
/* Harness nests the Settings dialog here too; only compact its native trigger. */
[data-paimind-navigation-settings] button:has(> [data-slot="settings.trigger"]){width:36px!important;height:36px!important;min-height:36px!important;padding:0!important;margin:0!important;display:flex;align-items:center;justify-content:center;border-radius:10px}
[data-paimind-navigation-settings] [data-slot="settings.trigger"]>span{display:none!important}
[data-paimind-navigation-footer] button[data-paimind-notification-trigger]{grid-column:1;grid-row:2;justify-self:start;width:36px!important;height:36px!important;min-height:36px!important;padding:0!important;margin:0!important;display:flex;justify-content:center;align-items:center;border-radius:10px!important}
[data-paimind-navigation-footer] [data-paimind-notification-trigger-label]{display:none!important}
[data-paimind-navigation-footer]:has([data-paimind-resource-navigation][data-wide="false"]){grid-template-columns:36px;justify-content:center}
[data-paimind-navigation-footer]:has([data-paimind-resource-navigation][data-wide="false"]) [data-paimind-navigation-settings]{grid-column:1;grid-row:3}
`
  doc.head.append(style)
  const marked = new Map<HTMLElement, Map<string, string | null>>()
  let sources = new Map<string, HTMLButtonElement>()
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
    attributes: true, attributeFilter: ['aria-current', 'disabled', 'data-paimind-product-trigger',
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
    dispose() { if (disposed) return; disposed = true; observer.disconnect(); restore(); style.remove(); sources.clear() },
  }
}
