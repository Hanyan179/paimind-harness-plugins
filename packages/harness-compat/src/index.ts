import type { ComponentType } from 'react'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  definePaimindExtension,
  type PaimindExtensionDescriptor,
} from '@paimind/contracts'

/** Visual primitives provided by `thinking-orbs`. */
export const RUNTIME_ORB_STATES = [
  'working', 'searching', 'solving', 'listening', 'connecting',
  'weaving', 'composing', 'breathing', 'shaping',
] as const

/** One concrete orb animation state. */
export type RuntimeOrbState = typeof RUNTIME_ORB_STATES[number]

/** RC8-native brand artwork isolated from PAIMind feature packages. */
export interface HarnessBrandSeat {
  readonly host: HTMLElement
  readonly nativeArt: SVGElement
}

/** RC8 new-session hero copy and artwork isolated from the branding package. */
export interface HarnessHeroBrandSeat {
  readonly host: HTMLElement
  readonly nativeIcon: HTMLElement
  readonly nativeHeadline: HTMLElement
  readonly nativePreview: HTMLElement
  readonly locale: 'zh' | 'en'
}

/** Native Sidebar and new-session brand seats currently exposed by Harness. */
export interface HarnessBrandSeats {
  readonly wordmark: HarnessBrandSeat | null
  readonly compact: HarnessBrandSeat | null
  readonly hero: HarnessHeroBrandSeat | null
}

/** Product identity applied by a PAIMind branding contribution. */
export interface HarnessDocumentBrandIdentity {
  readonly productName: string
  readonly faviconHref: string
  readonly manifestHref: string
}

const HARNESS_NATIVE_PRODUCT_NAME = 'DeepSeek Harness'
const HARNESS_WORDMARK_VIEWBOX = '0 0 182 24'
const HARNESS_COMPACT_LOGO_VIEWBOX = '0 0 23.16 17.04'
const HARNESS_HERO_COPY = {
  '探索未至之境': { locale: 'zh', preview: '预览版' },
  'Into the Unknown': { locale: 'en', preview: 'Preview' },
} as const

const brandSeatForViewBox = (root: ParentNode, viewBox: string): HarnessBrandSeat | null => {
  const nativeArt = root.querySelector<SVGElement>(`svg[viewBox="${viewBox}"]`)
  const host = nativeArt?.closest('button')
  return nativeArt !== null && nativeArt !== undefined && host instanceof HTMLElement
    ? { host, nativeArt }
    : null
}

const heroBrandSeat = (root: ParentNode): HarnessHeroBrandSeat | null => {
  const candidates = root.querySelectorAll<HTMLElement>('span')
  for (const nativeHeadline of candidates) {
    const copy = HARNESS_HERO_COPY[nativeHeadline.textContent?.trim() as keyof typeof HARNESS_HERO_COPY]
    if (copy === undefined) continue
    const host = nativeHeadline.parentElement
    if (host === null) continue
    const siblings = Array.from(host.children).filter((element): element is HTMLElement => element instanceof HTMLElement)
    const nativeIcon = siblings.find(element => element !== nativeHeadline && element.querySelector('svg') !== null)
    const preview = siblings.find(element => element.textContent?.trim() === copy.preview)
    if (nativeIcon === undefined || preview === undefined) continue
    return { host, nativeIcon, nativeHeadline, nativePreview: preview, locale: copy.locale }
  }
  return null
}

/**
 * Locate the native expanded and collapsed brand seats without exposing RC8
 * artwork selectors to the independently installable branding package.
 */
export function locateHarnessBrandSeats(root: ParentNode): HarnessBrandSeats {
  return {
    wordmark: brandSeatForViewBox(root, HARNESS_WORDMARK_VIEWBOX),
    compact: brandSeatForViewBox(root, HARNESS_COMPACT_LOGO_VIEWBOX),
    hero: heroBrandSeat(root),
  }
}

/** Preserve Harness's live Session title while replacing only its product suffix. */
export function brandHarnessDocumentTitle(title: string, productName: string): string {
  if (title === HARNESS_NATIVE_PRODUCT_NAME) return productName
  const suffix = ` — ${HARNESS_NATIVE_PRODUCT_NAME}`
  return title.endsWith(suffix) ? `${title.slice(0, -suffix.length)} — ${productName}` : title
}

/** Restore the native product suffix without discarding a live Session title. */
export function restoreHarnessDocumentTitle(title: string, productName: string): string {
  if (title === productName) return HARNESS_NATIVE_PRODUCT_NAME
  const suffix = ` — ${productName}`
  return title.endsWith(suffix) ? `${title.slice(0, -suffix.length)} — ${HARNESS_NATIVE_PRODUCT_NAME}` : title
}

/**
 * Apply reversible document-level identity. Harness keeps ownership of the
 * live Session-title prefix; the plugin owns only the product suffix and links.
 */
export function installHarnessDocumentBranding(
  doc: Document,
  identity: HarnessDocumentBrandIdentity,
): () => void {
  const existingIcon = doc.head.querySelector<HTMLLinkElement>('link[rel~="icon"]')
  const existingManifest = doc.head.querySelector<HTMLLinkElement>('link[rel="manifest"]')
  const icon = existingIcon ?? doc.createElement('link')
  const manifest = existingManifest ?? doc.createElement('link')
  const iconHref = existingIcon?.getAttribute('href')
  const iconType = existingIcon?.getAttribute('type')
  const manifestHref = existingManifest?.getAttribute('href')

  if (existingIcon === null) {
    icon.rel = 'icon'
    doc.head.append(icon)
  }
  if (existingManifest === null) {
    manifest.rel = 'manifest'
    doc.head.append(manifest)
  }
  icon.type = 'image/svg+xml'
  icon.href = identity.faviconHref
  manifest.href = identity.manifestHref

  const updateTitle = (): void => {
    const next = brandHarnessDocumentTitle(doc.title, identity.productName)
    if (next === doc.title) return
    doc.title = next
  }
  updateTitle()
  const observer = new MutationObserver(updateTitle)
  observer.observe(doc.head, { childList: true, subtree: true, characterData: true })

  return () => {
    observer.disconnect()
    doc.title = restoreHarnessDocumentTitle(doc.title, identity.productName)
    if (existingIcon === null) icon.remove()
    else {
      if (iconHref === null || iconHref === undefined) icon.removeAttribute('href')
      else icon.setAttribute('href', iconHref)
      if (iconType === null || iconType === undefined) icon.removeAttribute('type')
      else icon.setAttribute('type', iconType)
    }
    if (existingManifest === null) manifest.remove()
    else if (manifestHref === null || manifestHref === undefined) manifest.removeAttribute('href')
    else manifest.setAttribute('href', manifestHref)
  }
}

/** Semantic phases derived exclusively from Harness runtime facts. */
export type RuntimePhase =
  | 'loading'
  | 'working'
  | 'thinking'
  | 'planning'
  | 'tool-use'
  | 'searching'
  | 'shaping'
  | 'replying'
  | 'waiting'

/** Small public subset of a Harness in-flight tool call used by FP01. */
export interface HarnessRunningCall {
  readonly name: string
  readonly callId?: string
  readonly time?: number
  readonly callView?: HarnessToolCallView | null
  readonly subCalls?: readonly HarnessToolCallBlock[]
}

/** Browser-safe file location from a producer-declared Tool render intent. */
export interface HarnessToolFileLocation {
  readonly path: string
  readonly line?: number
}

/** Narrow Tool call presentation used to identify exact file reads. */
export type HarnessToolCallView =
  | {
    readonly card: 'generic'
    readonly title: string
    readonly kind?: 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'fetch' | 'other'
    readonly locations?: readonly HarnessToolFileLocation[]
  }
  | { readonly card: 'terminal'; readonly title: string; readonly cwd?: string }
  | { readonly card: 'diff'; readonly title: string; readonly locations?: readonly HarnessToolFileLocation[] }

/** Settled Tool record retained by the Chat target. */
export interface HarnessToolResultNode {
  readonly kind: 'tool-result'
  readonly callId: string
  readonly time: number
  readonly call: { readonly name: string; readonly argsRaw: string } | null
  readonly callView: HarnessToolCallView | null
  readonly isError: boolean
  readonly meta?: unknown
  readonly subCalls?: readonly HarnessToolCallBlock[]
}

/** Running or settled Tool record; recursive children stay producer-owned. */
export type HarnessToolCallBlock = HarnessRunningCall | HarnessToolResultNode

/** Stable subset of one final Chat node used by read-only PAIMind projections. */
export interface HarnessChatNode {
  readonly kind: string
  readonly data?: unknown
}

/** Small public subset of a Harness assistant partial used by FP01. */
export interface HarnessPartialAssistant {
  readonly blocks: readonly { readonly kind: string }[]
}

/** Version-isolated snapshot fields consumed by PAIMind runtime presentation. */
export interface HarnessConversationSnapshot {
  readonly openState: 'cold' | 'loading' | 'open' | 'error'
  readonly composerPhase: 'blank' | 'engaging' | 'active'
  readonly running: boolean
  readonly runningCalls: readonly HarnessRunningCall[]
  readonly pending: readonly { readonly kind: string }[]
  readonly partial: HarnessPartialAssistant | null
  /** Final business nodes already projected by Harness; only structural kinds are inspected. */
  readonly nodes?: readonly ({ readonly kind: string } & Readonly<Record<string, unknown>>)[]
  /** Public Turn timeline used by FP06 to read independently published deliverables data. */
  readonly chat?: {
    readonly nodes?: {
      values(): Iterable<HarnessChatNode>
    }
    readonly timeline: {
      readonly turnOrder: readonly number[]
      readonly turns: ReadonlyMap<number, HarnessTurnLocation>
    }
  }
  /** Independently assembled read-only views such as the native Trajectory ledger. */
  readonly views?: { get(key: string): unknown }
  /** Terminal Agent failure for the current Session, when present. */
  readonly lastAgentError?: string | null
  /** Current inbox snapshot; presence is enough for technical detail counts. */
  readonly queue?: readonly { readonly placement?: string }[]
}

/** Version-isolated public Turn data reader; values stay owned by their native plugin. */
export interface HarnessTurnLocationData {
  get(key: string): unknown
}

/** Minimal public Turn boundary consumed by the artifact projection. */
export interface HarnessTurnLocation {
  readonly turn: number
  readonly data: HarnessTurnLocationData
}

/** Runtime status displayed beside one orb. */
export interface RuntimePresentation {
  readonly phase: RuntimePhase
  readonly state: RuntimeOrbState
  readonly labelZh: string
  readonly labelEn: string
}

const PRESENTATIONS: Readonly<Record<RuntimePhase, Omit<RuntimePresentation, 'phase'>>> = {
  loading: { state: 'working', labelZh: '正在加载…', labelEn: 'Loading…' },
  working: { state: 'working', labelZh: '正在处理上下文…', labelEn: 'Processing context…' },
  thinking: { state: 'solving', labelZh: '正在思考…', labelEn: 'Thinking…' },
  planning: { state: 'weaving', labelZh: '正在整理计划…', labelEn: 'Structuring plan…' },
  'tool-use': { state: 'connecting', labelZh: '正在调用工具…', labelEn: 'Using tool…' },
  searching: { state: 'searching', labelZh: '正在搜索…', labelEn: 'Searching…' },
  shaping: { state: 'shaping', labelZh: '正在生成文件…', labelEn: 'Generating file…' },
  replying: { state: 'composing', labelZh: '正在回复…', labelEn: 'Responding…' },
  waiting: { state: 'breathing', labelZh: '等待你的选择', labelEn: 'Waiting for your choice' },
}

const PLANNING_TOOLS = new Set(['create_plan', 'update_plan', 'todo_write'])
const SHAPING_TOOLS = new Set(['generate_pdf', 'generate_ppt', 'create_presentation'])
const WORKING_TOOLS = new Set(['read', 'read_file', 'context_injection', 'inject_context'])
const SEARCH_TOOLS = new Set(['grep', 'rg', 'ripgrep', 'search', 'web_search'])

/** Resolve an exact tool id into its semantic phase; display prose is never inspected. */
export function phaseForToolName(name: string): RuntimePhase {
  const normalized = name.trim().toLowerCase()
  if (PLANNING_TOOLS.has(normalized)) return 'planning'
  if (SHAPING_TOOLS.has(normalized)) return 'shaping'
  if (WORKING_TOOLS.has(normalized)) return 'working'
  if (SEARCH_TOOLS.has(normalized)) return 'searching'
  return 'tool-use'
}

/** Derive the active PAIMind phase from public Harness snapshot facts. */
export function deriveRuntimePhase(snapshot: HarnessConversationSnapshot): RuntimePhase | null {
  if (snapshot.openState === 'loading' || snapshot.composerPhase === 'engaging') return 'loading'
  if (snapshot.pending.length > 0) return 'waiting'
  const runningCall = snapshot.runningCalls.at(-1)
  if (runningCall !== undefined) return phaseForToolName(runningCall.name)
  const lastBlock = snapshot.partial?.blocks.at(-1)
  if (lastBlock?.kind === 'reasoning') return 'thinking'
  if (lastBlock?.kind === 'text') return 'replying'
  if (snapshot.running && snapshot.nodes?.at(-1)?.kind === 'context') return 'working'
  if (snapshot.running) return 'thinking'
  return null
}

/** Resolve display state and localized labels for the active snapshot, or hide when idle. */
export function runtimePresentation(snapshot: HarnessConversationSnapshot): RuntimePresentation | null {
  const phase = deriveRuntimePhase(snapshot)
  return phase === null ? null : { phase, ...PRESENTATIONS[phase] }
}

/** Resolve the visual primitive for a semantic phase without exposing presentation tables. */
export function orbStateForRuntimePhase(phase: RuntimePhase): RuntimeOrbState {
  return PRESENTATIONS[phase].state
}

/**
 * Locate Harness's current-turn status row (the native `Deep diving...` surface).
 * The selector is structural and intentionally isolated here so upstream markup
 * drift has one compatibility boundary.
 */
export function locateRuntimeTurnStatus(root: ParentNode): HTMLElement | null {
  return [...root.querySelectorAll<HTMLElement>('[data-chat-flow] > [role="status"]')].at(-1) ?? null
}

/**
 * Locate every visible sidebar activity slot. Ongoing rows are always included;
 * the selected warning row is included only while the current session is waiting.
 */
export function locateRuntimeSidebarActivitySlots(
  phase: RuntimePhase,
  root: ParentNode,
): readonly HTMLElement[] {
  const dots = [...root.querySelectorAll<HTMLElement>('[role="treeitem"] [data-state="ongoing"]')]
  if (phase === 'waiting') {
    const selectedWarning = root.querySelector<HTMLElement>(
      '[role="treeitem"][aria-selected="true"] [data-state="warning"]',
    )
    if (selectedWarning !== null) dots.push(selectedWarning)
  }
  return [...new Set(dots.map(dot => dot.parentElement).filter((parent): parent is HTMLElement => parent !== null))]
}

/** One native history-row icon slot and the PAIMind primitive that replaces it. */
export interface RuntimeActivityIconSlot {
  readonly host: HTMLElement
  readonly state: RuntimeOrbState
}

/**
 * Locate the active collapsed leaf operation or contiguous parallel tool-call
 * batch. A faster sibling stays animated until the batch's final call settles;
 * a running parent yields to its more precise running children. Outside that
 * active batch, completed/failed/stopped/expanded rows keep native semantics.
 */
export function locateRuntimeActivityIconSlots(root: ParentNode): readonly RuntimeActivityIconSlot[] {
  interface Candidate {
    readonly carrier: HTMLElement
    readonly flowSeat: HTMLElement | null
    readonly running: boolean
    readonly slot: RuntimeActivityIconSlot
  }
  const candidates: Candidate[] = []
  for (const row of root.querySelectorAll<HTMLElement>('[data-chat-flow] [data-disclosure-row]')) {
    if (row.closest('[data-open="true"]') !== null) continue
    const carrier = row.closest<HTMLElement>('[data-variant], [data-tool]')
    const state = carrier?.dataset.state
    if (state !== 'running' && state !== 'ok') continue
    const tool = carrier?.dataset.tool
    const variant = carrier?.dataset.variant
    let orbState: RuntimeOrbState | null = null
    if (tool !== undefined && tool !== '') orbState = orbStateForRuntimePhase(phaseForToolName(tool))
    else if (variant === 'think') orbState = 'solving'
    else if (variant === 'others') orbState = 'connecting'
    else if (row.querySelector('[data-context-source]') !== null) orbState = 'working'
    if (orbState === null) continue
    const host = row.firstElementChild
    if (!(host instanceof HTMLElement)) continue
    if (carrier !== null) candidates.push({
      carrier,
      flowSeat: carrier.closest<HTMLElement>('[data-chat-flow-kind="tool-call"]'),
      running: state === 'running',
      slot: { host, state: orbState },
    })
  }
  // Bash owns a native specialized row instead of DisclosureRow, but exposes
  // stable sample/variant/state attributes and the same first-child leading slot.
  for (const row of root.querySelectorAll<HTMLElement>('[data-chat-flow] [data-sample="bash"][data-variant="bash"]')) {
    if (row.getAttribute('aria-expanded') === 'true') continue
    const state = row.dataset.state
    if (state !== 'running' && state !== 'ok') continue
    const host = row.firstElementChild
    if (!(host instanceof HTMLElement)) continue
    candidates.push({
      carrier: row,
      flowSeat: row.closest<HTMLElement>('[data-chat-flow-kind="tool-call"]'),
      running: state === 'running',
      slot: { host, state: 'connecting' },
    })
  }
  const active = new Set(candidates.filter(candidate => candidate.running))
  // Harness projects calls issued together as contiguous tool-call flow seats.
  // Keep the whole parallel batch animated until its final call settles, so a
  // faster sibling never appears completed while the batch is still active.
  for (const candidate of [...active]) {
    const seat = candidate.flowSeat
    if (seat === null) continue
    for (const direction of ['previousElementSibling', 'nextElementSibling'] as const) {
      let sibling = seat[direction]
      while (sibling instanceof HTMLElement && sibling.dataset.chatFlowKind === 'tool-call') {
        const grouped = candidates.find(entry => entry.flowSeat === sibling)
        if (grouped !== undefined) active.add(grouped)
        sibling = sibling[direction]
      }
    }
  }
  const hosts = new Set<HTMLElement>()
  return [...active]
    .sort((left, right) => (
      left.carrier.compareDocumentPosition(right.carrier) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
    ))
    .filter(candidate => ![...active].some(other => (
      other.carrier !== candidate.carrier && candidate.carrier.contains(other.carrier)
    )))
    .map(candidate => candidate.slot)
    .filter(slot => {
      if (hosts.has(slot.host)) return false
      hosts.add(slot.host)
      return true
    })
}

/** Selector-hook subset supplied by Harness session-scoped slots. */
export type HarnessSessionSelector = <T>(selector: (snapshot: HarnessConversationSnapshot) => T) => T

/** Minimal Harness session-list row facts used for sidebar activity. */
export interface HarnessSessionListSnapshot {
  readonly current: string | undefined
  readonly ids?: readonly string[]
  readonly byId: Readonly<Record<string, {
    readonly id?: string
    readonly title?: string
    readonly displayTitle?: string
    readonly cwd?: string
    readonly running: boolean
    readonly pendingInteraction?: string
    readonly completed?: boolean
    /** Native rule: only a blank Session may select another Agent Preset. */
    readonly blank?: boolean
    /** Preset id the native Session was composed from. */
    readonly agentPreset?: string
    readonly updatedAt?: number
    readonly projectionValues?: Readonly<Record<string, unknown>>
  } | undefined>>
  /** Native direct-child catalogs, keyed by exact parent Session id. */
  readonly subagentsByParent?: Readonly<Record<string, {
    readonly entries: readonly (
      | {
        readonly kind: 'child'
        readonly id: string
        readonly activity: 'running' | 'inactive'
        readonly hasChildren: boolean
        readonly mode: 'one-shot' | 'continuable'
        readonly label?: string
      }
      | { readonly kind: 'diagnostic'; readonly id: string; readonly reason: string }
    )[]
    readonly parentAvailable: boolean
  } | undefined>>
  /** Native `session/jobs` mirror; absence for one Session means no current records. */
  readonly jobsBySession?: Readonly<Record<string, readonly HarnessNativeJobView[] | undefined>>
}

/** Browser-safe native Harness Job record. */
export interface HarnessNativeJobView {
  readonly id: string
  readonly kind: string
  readonly label: string
  readonly status: 'running' | 'stopping' | 'completed' | 'killed' | 'failed'
  readonly detail?: string
  readonly startedAt: number
  readonly finishedAt?: number
}

/** Framework projection hook supplied to every strict Session slot. */
export type HarnessProjectionSelector = {
  (key: string): unknown
  <T>(key: string, selector: (value: unknown) => T, eq?: (left: T, right: T) => boolean): T
}

/** Additive Session-header action props used by the independent Task Monitor button. */
export interface PaimindSessionHeaderActionProps {
  readonly sessionId: string
  readonly useSession: HarnessSessionSelector
  /** Optional compatibility shares; current Header slots expose Session-local hooks only. */
  readonly useSessions?: HarnessSessionsSelector
  readonly useProjection?: HarnessProjectionSelector
}

/** Global selector hook supplied to every Harness slot contribution. */
export type HarnessSessionsSelector = <T>(selector: (snapshot: HarnessSessionListSnapshot) => T) => T

/** Minimal native Workspace record used by the PAIMind Project bridge. */
export interface HarnessWorkspaceView {
  readonly workspaceId: string
  readonly path: string
  readonly title: string
  readonly sessionIds: readonly string[]
  readonly createdAt: string
  readonly updatedAt: string
}

/** Version-isolated native Workspace-list snapshot. */
export interface HarnessWorkspaceListSnapshot {
  readonly items: readonly HarnessWorkspaceView[]
  readonly archivedSessionIds: readonly string[]
  readonly state: 'idle' | 'loading' | 'error'
  readonly phase?: string
  readonly error: { readonly message: string } | null
  readonly baselinesReady: boolean
  readonly recentWorkspaceId?: string
}

/** Global selector hook over native Workspace facts. */
export type HarnessWorkspacesSelector = <T>(selector: (snapshot: HarnessWorkspaceListSnapshot) => T) => T

/** Observable snapshot face exposed by native Harness domain services. */
export interface HarnessObservableSnapshot<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/** Native Workspace actions used by the read-only PAIMind bridge. */
export interface HarnessWorkspaceService {
  readonly list: HarnessObservableSnapshot<HarnessWorkspaceListSnapshot>
  startSession(workspaceId?: string): void
  openPath(path: string): Promise<void>
}

/** Native Session list service used by the PAIMind Project bridge. */
export interface HarnessSessionService {
  readonly list: HarnessObservableSnapshot<HarnessSessionListSnapshot>
  /** Select a canonical Harness Session as current; this owns no navigation state. */
  open(id: string): void
  /** Navigate to one exact catalog-derived child address without inventing lineage. */
  openSubagent?(address: {
    readonly parentSessionId: string
    readonly childSessionId: string
    readonly mode: 'one-shot' | 'continuable'
  }): void
  /** Public outward Session binding; optional keeps older Harness candidates fail-closed. */
  binding?(id: string): {
    readonly ctx?: object
    readonly session: HarnessObservableSnapshot<HarnessConversationSnapshot> & {
      readonly sessionId?: string
      readonly projections?: {
        faceOf(key: string): HarnessObservableSnapshot<unknown>
      }
      /** Public native prompt verb; Schedule product actions remain ordinary user turns. */
      prompt?(
        content: readonly { readonly type: 'text'; readonly text: string }[],
        mode: 'queue' | 'steer',
      ): Promise<
        | { readonly ok: true; readonly value: { readonly accepted: true } }
        | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }
      >
    }
  } | undefined
  /** Fold an acknowledged native Agent Preset selection into the shared Session row. */
  noteAgentPreset?(id: string, agentPreset: string): void
}

/** Native Agent Preset roster entry exposed by `agentPreset.list`. */
export interface HarnessAgentPresetEntry {
  readonly id: string
  readonly trust: 'system' | 'user'
  readonly isDefault: boolean
  readonly name?: string
  readonly description?: string
  readonly broken?: string
}

/** Native Agent Preset roster plus deployment authoring capabilities. */
export interface HarnessAgentPresetRoster {
  readonly presets: readonly HarnessAgentPresetEntry[]
  readonly authorable: boolean
  readonly hasDocument: boolean
}

/** Version-isolated RPC response face returned by the Harness API client. */
export interface HarnessRpcResponse<T> {
  readonly result: HarnessRemoteResult<T>
}

/** Native Agent Preset API seams consumed by FP09. */
export interface HarnessAgentPresetApi {
  list(payload: Record<string, never>): Promise<HarnessRpcResponse<HarnessAgentPresetRoster>>
  select(payload: { readonly sessionId: string; readonly agentPreset: string }): Promise<HarnessRpcResponse<{ readonly agentPreset: string }>>
  read(payload: { readonly agentPreset: string }): Promise<HarnessRpcResponse<{
    readonly agentPreset: string
    readonly trust: 'system' | 'user'
    readonly content: string
    readonly name?: string
    readonly description?: string
  }>>
  copy(payload: { readonly from: string; readonly agentPreset: string; readonly name?: string }): Promise<HarnessRpcResponse<{ readonly agentPreset: string }>>
  openDocument(payload: { readonly agentPreset: string }, signal?: AbortSignal): Promise<HarnessRpcResponse<
    { readonly opened: true } | { readonly opened: false; readonly path: string }
  >>
  remove(payload: { readonly agentPreset: string }): Promise<HarnessRpcResponse<Record<string, never>>>
}

/** Native new-conversation Preset selector snapshot rendered in the Harness hero. */
export interface HarnessAgentPresetSeatSnapshot {
  readonly current: string
  readonly busy: boolean
  readonly error: string | null
}

/** Version-isolated control face for the native new-conversation Preset selector. */
export interface HarnessAgentPresetSeatControl {
  getSnapshot(): HarnessAgentPresetSeatSnapshot
  load(): Promise<void>
  select(agentPreset: string): Promise<void>
}

/**
 * Resolve the native Agent Preset hero control from its public Slot contribution.
 * Calling the Host RPC directly changes Session state but bypasses the selector's
 * staged/current UI state, leaving the visible checkmark stale.
 */
export function resolveHarnessAgentPresetSeatControl(
  slots: HarnessInspectableSlotRegistry,
): HarnessAgentPresetSeatControl | null {
  const entries = slots.entries('conversation.hero.agentPreset')
    .filter(entry => typeof entry.inject === 'function')
  if (entries.length !== 1) return null
  try {
    const injected = entries[0]!.inject?.() as {
      readonly hooks?: {
        readonly agentPresetSeat?: HarnessObservableSnapshot<unknown>
      }
      readonly load?: () => Promise<void>
      readonly select?: (id: string) => Promise<void>
    } | undefined
    const store = injected?.hooks?.agentPresetSeat
    if (store === undefined || typeof injected?.load !== 'function' || typeof injected?.select !== 'function') return null
    const snapshot = (): HarnessAgentPresetSeatSnapshot | null => {
      const value = store.getSnapshot()
      if (typeof value !== 'object' || value === null) return null
      const candidate = value as { readonly current?: unknown; readonly busy?: unknown; readonly error?: unknown }
      if (typeof candidate.current !== 'string' || typeof candidate.busy !== 'boolean'
        || (candidate.error !== null && typeof candidate.error !== 'string')) return null
      return Object.freeze({ current: candidate.current, busy: candidate.busy, error: candidate.error })
    }
    if (snapshot() === null) return null
    return Object.freeze({
      getSnapshot(): HarnessAgentPresetSeatSnapshot {
        const current = snapshot()
        if (current === null) throw new Error('Harness Agent Preset selector returned an invalid snapshot')
        return current
      },
      async load(): Promise<void> { await injected.load!() },
      async select(agentPreset: string): Promise<void> { await injected.select!(agentPreset) },
    })
  } catch { return null }
}

/** Narrow connection handle; Harness version details remain behind compat. */
export interface HarnessAgentPresetConnection {
  readonly api: { readonly agentPresets: HarnessAgentPresetApi }
}

/** One token override accepted by the native Harness theme stack. */
export interface PaimindThemeTokenModes {
  readonly light: string
  readonly dark: string
}

/** Theme override dictionary kept behind the Harness compatibility boundary. */
export type PaimindThemeTokenOverrides = Readonly<Record<string, PaimindThemeTokenModes>>

/** Stable subset of the native Harness theme service used by FP17. */
export interface PaimindThemeService {
  overrideTokens(source: string, tokens: PaimindThemeTokenOverrides): () => void
}

/** Product category projected from one canonical native Agent Preset. */
export type HarnessAgentChoiceCategory = 'recommended' | 'platform-mode'

/** Read-only choice row; the Preset id remains the canonical Harness identity. */
export interface HarnessAgentChoice {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly trust: HarnessAgentPresetEntry['trust']
  readonly category: HarnessAgentChoiceCategory
}

/** Observable roster and selection state used by the visual Preset surface. */
export interface HarnessAgentChoiceSnapshot {
  readonly status: 'loading' | 'ready' | 'unavailable'
  readonly choices: readonly HarnessAgentChoice[]
  readonly current: string
  readonly busy: boolean
  readonly error: string | null
}

/**
 * Stable native-Preset bridge for compact product presentation. Selection is
 * delegated to the shipped hero control so staging and blank-Session binding
 * remain Harness-owned; restore only resynchronizes presentation state.
 */
export interface HarnessAgentChoiceBridge {
  getSnapshot(): HarnessAgentChoiceSnapshot
  subscribe(listener: () => void): () => void
  load(): Promise<boolean>
  select(id: string): Promise<void>
  restore(): void
  dispose(): void
}

/** Native Session-scoped Skill row exposed by `skill.list`. */
export interface HarnessSkillEntry {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly modelInvocable: boolean
}

/** Read-only public Skill catalog seam; invocation remains a normal Session prompt. */
export interface HarnessSkillsApi {
  list(payload: { readonly sessionId: string }, signal?: AbortSignal): Promise<HarnessRpcResponse<{
    readonly skills: readonly HarnessSkillEntry[]
  }>>
}

export interface HarnessSkillConnection {
  readonly api: { readonly skills: HarnessSkillsApi }
}

/** Props supplied to the additive FP04 Workspace-context header entry. */
export interface WorkspaceContextActionProps {
  readonly sessionId: string
  readonly useSessions: HarnessSessionsSelector
  readonly useWorkspaces: HarnessWorkspacesSelector
  readonly locale: PaimindLocaleSource
  readonly openWorkspacePath: (path: string) => Promise<void>
}

/** Props supplied to the FP01 composer-dock component by the Harness slot renderer. */
export interface RuntimeOrbDockProps {
  readonly useSession: HarnessSessionSelector
  readonly useSessions: HarnessSessionsSelector
  readonly locale?: PaimindLocaleSource
}

/** Version-isolated subset of Harness's observable locale service. */
export interface PaimindLocaleSource {
  getLocale(): { readonly active: string }
  subscribe(listener: () => void): () => void
}

/** Minimal Slot API used by PAIMind client plugins. */
export interface HarnessSlotRegistry {
  inject(name: string, install: () => (() => void) | Iterable<() => void>): void
  register<TProps extends object>(
    options: Readonly<Record<string, unknown>>,
    component: ComponentType<TProps>,
  ): () => void
}

/** Read-only ledger fields used by PAIMind's product catalog projection. */
export interface HarnessInspectableSlotEntry {
  readonly options: Readonly<Record<string, unknown>>
  readonly inject?: () => unknown
}

/** Public inspection face already exposed by the native Harness Slot service. */
export interface HarnessInspectableSlotRegistry extends HarnessSlotRegistry {
  entries(name: string): readonly HarnessInspectableSlotEntry[]
  subscribe(name: string, listener: () => void): () => void
  getVersion(name: string): number
}

/** Settings owner props supplied by the native `settings.section` surface. */
export interface HarnessSettingsSectionOwnerProps {
  readonly close: () => void
}

/** Reversible RC8 bridge for consolidating the native Preset page under Agent Center. */
export interface HarnessAgentPresetSettingsNavigation {
  /** Open Settings when needed, then activate the native Agent Presets page. */
  open(): boolean
  /** Restore the native navigation row and stop observing the Settings shell. */
  dispose(): void
}

function resolveHarnessSettingsLabel(entry: HarnessInspectableSlotEntry): string | undefined {
  const raw = entry.options.label
  try {
    const value = typeof raw === 'function' ? (raw as () => unknown)() : raw
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
  } catch { return undefined }
}

function resolveHarnessSettingsTrigger(doc: Document): HTMLButtonElement | null {
  const eligible = (button: HTMLButtonElement): boolean => button.closest('[role="dialog"]') === null && !button.disabled
  const slotted = [...new Set(
    [...doc.querySelectorAll<HTMLElement>('[data-slot="settings.trigger"]')]
      .map(node => node.closest<HTMLButtonElement>('button'))
      .filter((button): button is HTMLButtonElement => button !== null && eligible(button)),
  )]
  if (slotted.length === 1) return slotted[0]!

  const legacy = [...doc.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="dialog"][aria-expanded]')]
    .filter(eligible)
  return legacy.length === 1 ? legacy[0]! : null
}

/**
 * Hide only the exact native `agent-presets` navigation row while retaining its
 * registered page. RC8 keeps active-section state inside the Settings shell and
 * exposes no public navigation controller, so the DOM lookup is isolated here,
 * exact-label matched, reversible, and deliberately fail-open on markup drift.
 */
export function installHarnessAgentPresetSettingsNavigation(
  slots: HarnessInspectableSlotRegistry,
  doc: Document = document,
): HarnessAgentPresetSettingsNavigation {
  let pendingOpen = false
  const hidden = new Map<HTMLButtonElement, {
    readonly hidden: boolean
    readonly display: string
    readonly displayPriority: string
  }>()

  const restore = (): void => {
    for (const [button, previous] of hidden) {
      button.hidden = previous.hidden
      if (previous.display === '') button.style.removeProperty('display')
      else button.style.setProperty('display', previous.display, previous.displayPriority)
      delete button.dataset.paimindHiddenSettingsSection
    }
    hidden.clear()
  }

  const refresh = (): HTMLButtonElement | null => {
    restore()
    const entries = slots.entries('settings.section')
      .filter(entry => entry.options.id === 'agent-presets')
    if (entries.length !== 1) return null
    const label = resolveHarnessSettingsLabel(entries[0]!)
    if (label === undefined) return null
    const dialog = doc.querySelector<HTMLElement>('[role="dialog"]')
    if (dialog === null) return null
    const matches = [...dialog.querySelectorAll<HTMLButtonElement>('nav button')]
      .filter(button => button.textContent?.trim() === label)
    if (matches.length !== 1) return null
    const button = matches[0]!
    hidden.set(button, {
      hidden: button.hasAttribute('hidden'),
      display: button.style.getPropertyValue('display'),
      displayPriority: button.style.getPropertyPriority('display'),
    })
    button.hidden = true
    button.style.setProperty('display', 'none', 'important')
    button.dataset.paimindHiddenSettingsSection = 'agent-presets'
    return button
  }

  const activatePending = (): void => {
    if (!pendingOpen) return
    const button = refresh()
    if (button === null) return
    pendingOpen = false
    button.click()
  }

  const Observer = doc.defaultView?.MutationObserver ?? MutationObserver
  const observer = new Observer(() => { if (pendingOpen) activatePending(); else refresh() })
  observer.observe(doc.documentElement, { childList: true, subtree: true })
  const offSlots = slots.subscribe('settings.section', refresh)
  refresh()

  return Object.freeze({
    open(): boolean {
      const button = refresh()
      if (button !== null) {
        pendingOpen = false
        button.click()
        return true
      }
      const settingsTrigger = resolveHarnessSettingsTrigger(doc)
      if (settingsTrigger === null) return false
      pendingOpen = true
      settingsTrigger.click()
      activatePending()
      return true
    },
    dispose(): void {
      pendingOpen = false
      observer.disconnect()
      offSlots()
      restore()
    },
  })
}

/** Exact read-only technical lifecycle currently returned by Harness. */
export type HarnessPluginFiberPhase =
  | 'pending'
  | 'loading'
  | 'active'
  | 'failed'
  | 'unloading'
  | null

/** Version-isolated native Loader entry consumed by Extension Center. */
export interface HarnessPluginInventoryEntry {
  readonly entryId: string
  readonly moduleName: string
  readonly enabled: boolean
  readonly fiberPhase: HarnessPluginFiberPhase
}

/** Point-in-time technical inventory; Harness remains its only source of truth. */
export interface HarnessPluginInventorySnapshot {
  readonly entries: readonly HarnessPluginInventoryEntry[]
}

/** Generated Remote result shape exposed by the Harness client runtime. */
export type HarnessRemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** Read-only remote owned by native Harness Plugin Inventory. */
export interface HarnessPluginInventoryRemote {
  list(): Promise<HarnessRemoteResult<HarnessPluginInventorySnapshot>>
}

/** Context required by the independent PAIMind Extension Center package. */
export interface PaimindExtensionCenterClientContext extends PaimindClientContext {
  readonly slots: HarnessInspectableSlotRegistry
  readonly remote: {
    readonly pluginInventory: HarnessPluginInventoryRemote
  }
}

/** Context required by the independent read-only Developer Resources package. */
export interface PaimindDeveloperResourcesClientContext extends PaimindClientContext {
  readonly slots: HarnessInspectableSlotRegistry
  readonly remote: {
    readonly pluginInventory: HarnessPluginInventoryRemote
  }
}

const NullExtensionContribution = (): null => null

/**
 * Contribute immutable product metadata through a PAIMind-owned child slot.
 * The contribution waits when Extension Center is absent and therefore never
 * becomes a runtime dependency of the feature package.
 */
export function contributePaimindExtension(
  slots: HarnessSlotRegistry,
  input: PaimindExtensionDescriptor,
): void {
  const descriptor = definePaimindExtension(input)
  slots.inject('paimind.extension', () => slots.register({
    name: 'paimind.extension',
    id: descriptor.id,
    order: descriptor.order ?? 0,
    inject: () => ({ descriptor }),
  }, NullExtensionContribution))
}

/** Minimal Cordis reflection service used to publish cross-plugin controllers. */
export interface HarnessReflectRegistry {
  provide(name: string, service: unknown): () => void | Promise<void>
}

/** Dynamic Typert contribution mount exposed by the native Remote client. */
export interface HarnessRemoteMountService {
  $mount(contribution: unknown): Promise<() => void | Promise<void>>
}

/** Minimal Cordis client context used by FP01. */
export interface PaimindClientContext {
  readonly slots: HarnessSlotRegistry
  readonly locale: PaimindLocaleSource
  readonly reflect: HarnessReflectRegistry
  effect(install: () => void | (() => void), label?: string): void
}

/** Client-side snapshot of one native Harness Settings namespace. */
export interface PaimindSettingsScopeSnapshot<T extends object> {
  readonly status: 'loading' | 'ready' | 'unavailable'
  readonly value: Readonly<T> | undefined
  readonly base: unknown
  readonly user: unknown
  readonly revision: number | undefined
  readonly writable: boolean
  readonly mode: 'host' | 'memory'
}

/** Stable client owner handle over one native Settings namespace. */
export interface PaimindSettingsScope<T extends object> {
  getSnapshot(): PaimindSettingsScopeSnapshot<T>
  subscribe(listener: () => void): () => void
  set(field: keyof T & string, value: unknown): Promise<void>
  unset(field: keyof T & string): Promise<void>
}

/** Native Settings Scope binder isolated from the client feature package. */
export interface PaimindSettingsScopeBinder {
  bind<T extends object>(spec: {
    readonly namespace: string
    readonly decode?: (section: unknown) => T | undefined
  }): PaimindSettingsScope<T>
}

/**
 * Translate a PAIMind product namespace into RC8's lowercase kebab-case
 * Settings key. Product contracts may keep dotted ownership names while the
 * Harness storage adapter remains compliant with its native namespace grammar.
 */
export function resolveHarnessSettingsNamespace(namespace: string): string {
  const resolved = namespace.replaceAll('.', '-')
  if (!/^[a-z][a-z0-9-]*$/.test(resolved)) {
    throw new TypeError(`PAIMind Settings namespace "${namespace}" cannot be represented by Harness`)
  }
  return resolved
}

/** Scoped services used by a PAIMind Settings section contribution. */
export interface PaimindUserSettingsScope extends PaimindClientContext {
  readonly settingsScope: PaimindSettingsScopeBinder
}

/** Root context required by a PAIMind-owned native Settings section. */
export interface PaimindUserSettingsClientContext extends PaimindClientContext {
  inject(
    services: readonly string[],
    install: (scope: PaimindUserSettingsScope) => void | (() => void),
    label?: string,
  ): void
}

/** Session-scoped context used by the Agent Center Settings contribution. */
export interface PaimindAgentCenterScope extends PaimindClientContext {
  readonly sessions: HarnessSessionService
}

/** Root context required by the native-Preset-backed Agent Center. */
export interface PaimindAgentCenterClientContext extends PaimindClientContext {
  get(name: 'connection'): HarnessAgentPresetConnection
  inject(
    services: readonly string[],
    install: (scope: PaimindAgentCenterScope) => void | (() => void),
    label?: string,
  ): void
}

/** Native scoped conversation draft seam used only for Creator-mode handoff. */
export interface HarnessConversationDraftService {
  readonly input: {
    for(context: object): { setDraft(text: string): void }
  }
}

/** Session/Workspace scope used by the native-Preset-backed Builder. */
export interface PaimindAgentBuilderScope extends PaimindClientContext {
  readonly sessions: HarnessSessionService
  readonly workspaces: HarnessWorkspaceService
  readonly conversation: HarnessConversationDraftService
}

/** Root context required by the FP10 Personal Agent Builder. */
export interface PaimindAgentBuilderClientContext extends PaimindClientContext {
  get(name: 'connection'): HarnessAgentPresetConnection
  inject(
    services: readonly string[],
    install: (scope: PaimindAgentBuilderScope) => void | (() => void),
    label?: string,
  ): void
}

/** Session scope used by the native Skill-catalog-backed market. */
export interface PaimindSkillMarketScope extends PaimindClientContext {
  readonly sessions: HarnessSessionService
  readonly conversation: HarnessConversationDraftService
}

/** Root context required by FP11 Skill Market. */
export interface PaimindSkillMarketClientContext extends PaimindClientContext {
  get(name: 'connection'): HarnessSkillConnection
  inject(
    services: readonly string[],
    install: (scope: PaimindSkillMarketScope) => void | (() => void),
    label?: string,
  ): void
}

/** Client services required specifically by FP04. */
export interface PaimindWorkspaceClientContext extends PaimindClientContext {
  readonly sessions: HarnessSessionService
  readonly workspaces: HarnessWorkspaceService
}

/** Minimal invariant registry used by feature-package companions. */
export interface PaimindInvariantContext {
  readonly invariants: {
    register(packageName: string, install: () => void): () => void
  }
}

/** Version-isolated host Web route used by PAIMind-owned loopback services. */
export interface PaimindHostWebRoute {
  readonly kind: 'prefix' | 'exact'
  readonly path: string
  readonly handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
}

/** Public structural subset of the Harness host Web server. */
export interface PaimindHostWebServer {
  register(route: PaimindHostWebRoute): () => void
}

/** Public structural subset of one attached Harness Session. */
export interface PaimindHostSession {
  readonly header: { readonly cwd?: string }
}

/** Public structural subset used only to authorize a Session-scoped file. */
export interface PaimindHostSessionService {
  get(id: string): PaimindHostSession | undefined
}

/** Minimal raw Event face returned by Harness's native paginated Session history. */
export interface HarnessSessionHistoryEvent {
  readonly type: string
  readonly seq?: number
  readonly time?: number
  readonly data?: unknown
}

/** Read-only native Session-history API used to fold complete resource evidence. */
export interface HarnessSessionHistoryApi {
  history(payload: {
    readonly sessionId: string
    readonly beforeSeq?: number
    readonly maxMessages?: number
  }, signal?: AbortSignal): Promise<HarnessRpcResponse<{
    readonly events: readonly { readonly event: HarnessSessionHistoryEvent }[]
    readonly hasMore: boolean
  }>>
}

/** Host services required by the isolated Bento renderer package. */
export interface PaimindBentoHostContext {
  readonly webServer: PaimindHostWebServer
  readonly sessions: PaimindHostSessionService
}
export * from './client-input-trigger.js'
