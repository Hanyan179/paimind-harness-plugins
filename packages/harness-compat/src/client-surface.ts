/** Shared product-surface ids; Harness still owns shell routing and history. */
export const PAIMIND_PRODUCT_SURFACE_IDS = ['agent-center', 'skill-center'] as const

export type PaimindProductSurfaceId = typeof PAIMIND_PRODUCT_SURFACE_IDS[number]

export interface PaimindProductSurfaceSnapshot {
  readonly open: boolean
}

const OPEN_EVENT = 'paimind:product-surface:open'

interface PaimindProductSurfaceEventDetail {
  readonly id: PaimindProductSurfaceId
}

const closedSnapshot: PaimindProductSurfaceSnapshot = Object.freeze({ open: false })
const openSnapshot: PaimindProductSurfaceSnapshot = Object.freeze({ open: true })

function productSurfaceTrigger(
  doc: Document,
  id: PaimindProductSurfaceId,
): HTMLButtonElement | null {
  return doc.querySelector<HTMLButtonElement>(`button[data-paimind-product-trigger="${id}"]`)
}

/** Announce one PAIMind surface without introducing a second router or store. */
export function requestPaimindProductSurface(
  id: PaimindProductSurfaceId,
  win: Window = window,
): void {
  const event = win.document.createEvent('CustomEvent')
  event.initCustomEvent(OPEN_EVENT, false, false, { id } satisfies PaimindProductSurfaceEventDetail)
  win.dispatchEvent(event)
}

/** A switch is offered only while the target plugin has a live sidebar entry. */
export function isPaimindProductSurfaceAvailable(
  id: PaimindProductSurfaceId,
  doc: Document = document,
): boolean {
  return productSurfaceTrigger(doc, id) !== null
}

/**
 * Lightweight client-only viewing controller.  It owns no Agent, Skill,
 * Session, URL, or persisted state; DOM events only coordinate two separately
 * installable full-page contributions.
 */
export class PaimindProductSurfaceController {
  private snapshot: PaimindProductSurfaceSnapshot = closedSnapshot
  private readonly listeners = new Set<() => void>()
  private disposed = false
  private restoreTarget: HTMLElement | null = null

  constructor(
    readonly id: PaimindProductSurfaceId,
    private readonly win: Window = window,
    private readonly doc: Document = document,
  ) {
    this.win.addEventListener(OPEN_EVENT, this.onOpenRequest as EventListener)
  }

  getSnapshot = (): PaimindProductSurfaceSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => {}
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  open(trigger?: HTMLElement): void {
    if (trigger !== undefined) this.restoreTarget = trigger
    requestPaimindProductSurface(this.id, this.win)
  }

  close(restoreFocus = true): void {
    if (!this.snapshot.open) return
    this.publish(closedSnapshot)
    if (!restoreFocus) return
    const target = this.restoreTarget?.isConnected === true
      ? this.restoreTarget
      : productSurfaceTrigger(this.doc, this.id)
    this.win.setTimeout(() => { target?.focus() }, 0)
  }

  toggle(trigger?: HTMLElement): void {
    if (this.snapshot.open) this.close()
    else this.open(trigger)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.win.removeEventListener(OPEN_EVENT, this.onOpenRequest as EventListener)
    this.snapshot = closedSnapshot
    this.listeners.clear()
    this.restoreTarget = null
  }

  private readonly onOpenRequest = (event: CustomEvent<PaimindProductSurfaceEventDetail>): void => {
    if (this.disposed) return
    const id = event.detail?.id
    if (id === undefined || !PAIMIND_PRODUCT_SURFACE_IDS.includes(id)) return
    if (id === this.id) this.publish(openSnapshot)
    else this.close(false)
  }

  private publish(snapshot: PaimindProductSurfaceSnapshot): void {
    if (this.snapshot === snapshot) return
    this.snapshot = snapshot
    for (const listener of [...this.listeners]) listener()
  }
}

function focusableElements(root: HTMLElement): HTMLElement[] {
  const selector = [
    'button:not(:disabled)',
    'a[href]',
    'input:not(:disabled)',
    'select:not(:disabled)',
    'textarea:not(:disabled)',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',')
  return [...root.querySelectorAll<HTMLElement>(selector)]
    .filter(element => !element.hidden && element.getAttribute('aria-hidden') !== 'true')
}

/** Install Escape, focus containment, initial focus, and scroll isolation. */
export function installPaimindProductSurfaceInteraction(
  root: HTMLElement,
  controller: PaimindProductSurfaceController,
  doc: Document = document,
): () => void {
  const previousOverflow = doc.body.style.overflow
  doc.body.style.overflow = 'hidden'
  const first = root.querySelector<HTMLElement>('[data-paimind-product-initial-focus]')
    ?? focusableElements(root)[0]
  first?.focus()

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      controller.close()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = focusableElements(root)
    if (focusable.length === 0) { event.preventDefault(); return }
    const firstElement = focusable[0]!
    const lastElement = focusable.at(-1)!
    if (event.shiftKey && doc.activeElement === firstElement) {
      event.preventDefault(); lastElement.focus()
    } else if (!event.shiftKey && doc.activeElement === lastElement) {
      event.preventDefault(); firstElement.focus()
    }
  }
  doc.addEventListener('keydown', onKeyDown)
  return () => {
    doc.removeEventListener('keydown', onKeyDown)
    doc.body.style.overflow = previousOverflow
  }
}

export interface HarnessScheduledSessionMarkerSnapshot {
  readonly ids?: readonly string[]
  readonly byId: Readonly<Record<string, {
    readonly id?: string
    readonly title?: string
    readonly displayTitle?: string
    readonly blank?: boolean
  } | undefined>>
}

export interface HarnessScheduledSessionMarkerSource {
  getSessionSnapshot(): HarnessScheduledSessionMarkerSnapshot
  getScheduledSessionIds(): ReadonlySet<string>
  subscribe(listener: () => void): () => void
}

const SCHEDULED_MARKER = 'data-paimind-scheduled-session'
const SCHEDULED_TIME = 'data-paimind-scheduled-native-time'

function sessionTitle(row: HarnessScheduledSessionMarkerSnapshot['byId'][string]): string | undefined {
  if (row === undefined || row.blank === true) return undefined
  const title = row.displayTitle ?? row.title
  return title === undefined || title.trim() === '' ? undefined : title.trim()
}

function restoreScheduledMarker(row: HTMLElement): void {
  row.removeAttribute(SCHEDULED_MARKER)
  row.querySelector<HTMLElement>(`:scope > [${SCHEDULED_MARKER}]`)?.remove()
  const time = row.querySelector<HTMLElement>(`:scope > [${SCHEDULED_TIME}]`)
  if (time !== null) {
    const original = time.getAttribute(SCHEDULED_TIME)
    if (original === null || original === '') time.removeAttribute('style')
    else time.setAttribute('style', original)
    time.removeAttribute(SCHEDULED_TIME)
  }
}

function clockMarker(doc: Document): HTMLSpanElement {
  const marker = doc.createElement('span')
  marker.setAttribute(SCHEDULED_MARKER, 'clock')
  marker.setAttribute('role', 'img')
  marker.setAttribute('aria-label', '已安排任务')
  marker.title = '已安排任务'
  marker.style.cssText = 'position:relative;display:inline-block;flex:none;width:14px;height:14px;box-sizing:border-box;border:1.25px solid currentColor;border-radius:50%;color:var(--dsw-alias-label-tertiary,#78849a)'
  const hour = doc.createElement('span')
  hour.style.cssText = 'position:absolute;left:6px;top:2.5px;width:1px;height:4px;border-radius:1px;background:currentColor;transform-origin:bottom center'
  const minute = doc.createElement('span')
  minute.style.cssText = 'position:absolute;left:6px;top:6px;width:3.5px;height:1px;border-radius:1px;background:currentColor;transform-origin:left center;transform:rotate(22deg)'
  marker.append(hour, minute)
  return marker
}

/**
 * RC6 presentation adapter for the native Session tree. It marks a row only
 * when its visible title maps entirely to scheduled canonical Session ids.
 * Ambiguous mixed scheduled/ordinary duplicate titles fail closed.
 */
export function installHarnessScheduledSessionMarkers(
  source: HarnessScheduledSessionMarkerSource,
  doc: Document = document,
): () => void {
  let disposed = false
  let queued = false
  const apply = (): void => {
    queued = false
    if (disposed) return
    const snapshot = source.getSessionSnapshot()
    const scheduled = source.getScheduledSessionIds()
    const ids = snapshot.ids ?? Object.keys(snapshot.byId)
    const candidates = new Map<string, string[]>()
    for (const id of ids) {
      const title = sessionTitle(snapshot.byId[id])
      if (title === undefined) continue
      const group = candidates.get(title) ?? []
      group.push(id)
      candidates.set(title, group)
    }
    const rows = [...doc.querySelectorAll<HTMLElement>('[role="treeitem"][aria-selected]')]
    const rowsByTitle = new Map<string, HTMLElement[]>()
    for (const row of rows) {
      const title = [...row.querySelectorAll<HTMLElement>(':scope > span')]
        .map(element => element.textContent?.trim() ?? '')
        .find(value => candidates.has(value))
      if (title === undefined) { restoreScheduledMarker(row); continue }
      const group = rowsByTitle.get(title) ?? []
      group.push(row)
      rowsByTitle.set(title, group)
    }
    const desired = new Map<HTMLElement, string>()
    for (const [title, titleRows] of rowsByTitle) {
      const titleIds = candidates.get(title) ?? []
      if (titleIds.length === 0 || !titleIds.every(id => scheduled.has(id))) continue
      for (const row of titleRows) desired.set(row, title)
    }
    for (const row of rows) {
      const title = desired.get(row)
      if (title === undefined) { restoreScheduledMarker(row); continue }
      if (row.getAttribute(SCHEDULED_MARKER) === 'row'
        && row.querySelector(`:scope > [${SCHEDULED_MARKER}="clock"]`) !== null
        && row.querySelector(`:scope > [${SCHEDULED_TIME}]`) !== null) continue
      restoreScheduledMarker(row)
        const direct = [...row.querySelectorAll<HTMLElement>(':scope > span')]
        const titleIndex = direct.findIndex(element => element.textContent?.trim() === title)
        const nativeTime = direct.slice(titleIndex + 1).find(element => (element.textContent?.trim() ?? '') !== '')
        if (nativeTime !== undefined) {
          nativeTime.setAttribute(SCHEDULED_TIME, nativeTime.getAttribute('style') ?? '')
          nativeTime.style.display = 'none'
        }
        row.setAttribute(SCHEDULED_MARKER, 'row')
        row.append(clockMarker(doc))
    }
  }
  const schedule = (): void => {
    if (disposed || queued) return
    queued = true
    queueMicrotask(apply)
  }
  const observer = new MutationObserver(schedule)
  observer.observe(doc.body, { childList: true, subtree: true, characterData: true })
  const unsubscribe = source.subscribe(schedule)
  apply()
  return () => {
    disposed = true
    observer.disconnect()
    unsubscribe()
    for (const row of doc.querySelectorAll<HTMLElement>(`[${SCHEDULED_MARKER}="row"]`)) restoreScheduledMarker(row)
  }
}
