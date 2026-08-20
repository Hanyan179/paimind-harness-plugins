import type {
  HarnessAgentChoice,
  HarnessAgentChoiceBridge,
  HarnessAgentChoiceSnapshot,
  HarnessAgentPresetApi,
  HarnessAgentPresetSeatControl,
} from './index.js'

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

export type PaimindExperienceMode = 'paimind' | 'native'
export type PaimindExperienceDensity = 'calm' | 'focus' | 'workbench'

const EXPERIENCE_MARKERS = [
  'data-paimind-shell',
  'data-paimind-hero',
  'data-paimind-composer',
  'data-paimind-conversation',
  'data-paimind-sidebar',
] as const

/**
 * Reversible semantic marker controller over RC8's public data attributes.
 * It never replaces a Harness root; it only annotates existing shell regions.
 */
export class HarnessExperienceMarkers {
  private mode: PaimindExperienceMode = 'native'
  private disposed = false
  private queued = false
  private readonly observer: MutationObserver

  constructor(private readonly doc: Document = document) {
    this.observer = new MutationObserver(() => { this.schedule() })
    this.observer.observe(doc.body, {
      attributes: true,
      attributeFilter: ['data-phase', 'data-dsh-sidebar-collapsed', 'data-sidebar-collapsed', 'data-details-collapsed'],
      childList: true,
      subtree: true,
    })
    this.apply()
  }

  setMode(mode: PaimindExperienceMode): void {
    if (this.disposed || this.mode === mode) return
    this.mode = mode
    this.apply()
  }

  getMode(): PaimindExperienceMode { return this.mode }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.observer.disconnect()
    const body = this.doc.body
    body.removeAttribute('data-paimind-experience')
    body.removeAttribute('data-paimind-density')
    for (const marker of EXPERIENCE_MARKERS) {
      for (const element of this.doc.querySelectorAll<HTMLElement>(`[${marker}]`)) element.removeAttribute(marker)
    }
  }

  private schedule(): void {
    if (this.queued || this.disposed) return
    this.queued = true
    queueMicrotask(() => {
      this.queued = false
      this.apply()
    })
  }

  private apply(): void {
    if (this.disposed) return
    const body = this.doc.body
    body.dataset.paimindExperience = this.mode
    const phase = this.doc.querySelector<HTMLElement>('[data-phase="active"], [data-phase="hero"], [data-phase="settling"]')
    const betterSidebar = this.doc.querySelector<HTMLElement>('[data-dsh-better-sidebar]')
    const betterSidebarOpen = betterSidebar !== null
      && !body.hasAttribute('data-dsh-sidebar-collapsed')
      && betterSidebar.getAttribute('aria-hidden') !== 'true'
    const density: PaimindExperienceDensity = this.mode === 'native'
      ? 'calm'
      : betterSidebarOpen ? 'workbench' : phase?.dataset.phase === 'active' ? 'focus' : 'calm'
    body.dataset.paimindDensity = density

    this.markOne(body, 'data-paimind-shell')
    this.markOne(phase, 'data-paimind-conversation')
    this.markOne(this.doc.querySelector<HTMLElement>('[data-phase="hero"]'), 'data-paimind-hero')
    this.markOne(this.doc.querySelector<HTMLElement>('[data-composer-card]'), 'data-paimind-composer')
    this.markOne(this.doc.querySelector<HTMLElement>('[data-slot="sidebar"]'), 'data-paimind-sidebar')
  }

  private markOne(element: HTMLElement | null, marker: typeof EXPERIENCE_MARKERS[number]): void {
    for (const previous of this.doc.querySelectorAll<HTMLElement>(`[${marker}]`)) {
      if (this.mode === 'native' || previous !== element) previous.removeAttribute(marker)
    }
    if (element !== null && this.mode === 'paimind') element.setAttribute(marker, '')
  }
}

const PLATFORM_MODE_IDS = new Set(['standard', 'ptc', 'code', 'minimal', 'cordis'])

function agentChoiceName(id: string, name: string | undefined): string {
  const normalized = name?.trim()
  return normalized === undefined || normalized === '' ? id : normalized
}

function agentChoiceDescription(description: string | undefined): string {
  const normalized = description?.trim()
  return normalized === undefined || normalized === '' ? '由 Harness 原生 Agent Preset 提供。' : normalized
}

/** Native implementation of the FP17 Agent choice bridge. */
export class NativeHarnessAgentChoiceBridge implements HarnessAgentChoiceBridge {
  private snapshot: HarnessAgentChoiceSnapshot
  private readonly listeners = new Set<() => void>()
  private disposed = false
  private generation = 0

  constructor(
    private readonly api: HarnessAgentPresetApi,
    private readonly nativeSeat: HarnessAgentPresetSeatControl,
  ) {
    const seat = nativeSeat.getSnapshot()
    this.snapshot = Object.freeze({
      status: 'loading', choices: Object.freeze([]), current: seat.current,
      busy: seat.busy, error: seat.error,
    })
  }

  getSnapshot(): HarnessAgentChoiceSnapshot { return this.snapshot }

  subscribe(listener: () => void): () => void {
    if (this.disposed) return () => {}
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async load(): Promise<boolean> {
    const generation = ++this.generation
    this.publish({ ...this.snapshot, status: 'loading', error: null })
    try {
      await this.nativeSeat.load()
      const response = await this.api.list({})
      if (this.disposed || generation !== this.generation) return false
      if (!response.result.ok) {
        this.publish({ ...this.snapshot, status: 'unavailable', choices: Object.freeze([]), error: response.result.error.message })
        return false
      }
      const choices = response.result.value.presets
        .filter(preset => preset.broken === undefined)
        .map((preset): HarnessAgentChoice => Object.freeze({
          id: preset.id,
          name: agentChoiceName(preset.id, preset.name),
          description: agentChoiceDescription(preset.description),
          trust: preset.trust,
          category: PLATFORM_MODE_IDS.has(preset.id) ? 'platform-mode' : 'recommended',
        }))
      const seat = this.nativeSeat.getSnapshot()
      if (choices.length === 0 || !choices.some(choice => choice.id === seat.current)) {
        this.publish({ ...this.snapshot, status: 'unavailable', choices: Object.freeze([]), current: seat.current, busy: seat.busy, error: seat.error })
        return false
      }
      this.publish({
        status: 'ready', choices: Object.freeze(choices), current: seat.current,
        busy: seat.busy, error: seat.error,
      })
      return true
    } catch (error) {
      if (this.disposed || generation !== this.generation) return false
      this.publish({
        ...this.snapshot, status: 'unavailable', choices: Object.freeze([]),
        error: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }

  async select(id: string): Promise<void> {
    if (this.disposed || this.snapshot.status !== 'ready' || !this.snapshot.choices.some(choice => choice.id === id)) return
    this.publish({ ...this.snapshot, busy: true, error: null })
    try {
      await this.nativeSeat.select(id)
      if (this.disposed) return
      const seat = this.nativeSeat.getSnapshot()
      this.publish({ ...this.snapshot, current: seat.current || id, busy: seat.busy, error: seat.error })
    } catch (error) {
      if (this.disposed) return
      this.publish({ ...this.snapshot, busy: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

  restore(): void {
    if (this.disposed) return
    const seat = this.nativeSeat.getSnapshot()
    this.publish({ ...this.snapshot, current: seat.current, busy: seat.busy, error: seat.error })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.generation += 1
    this.listeners.clear()
  }

  private publish(snapshot: HarnessAgentChoiceSnapshot): void {
    this.snapshot = Object.freeze(snapshot)
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
 * RC8 presentation adapter for the native Session tree. It marks a row only
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
