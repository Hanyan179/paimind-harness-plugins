import type { ReactNode } from 'react'
import type { PaimindLocaleSource } from '@hansen/harness-compat'
import type { PaimindWorkspaceProjectService } from '@hansen/workspace-project'

/** Host half of the FP05 adapter plugin. */
export const name = 'paimind-better-sidebar-adapter'

/** The adapter is client-only; the provider's host routes stay provider-owned. */
export function apply(): void {}

/** Stable PAIMind-side contract version, independent of the provider package version. */
export const PAIMIND_SIDEBAR_CONTRACT_VERSION = 4 as const
/** Exactly verified provider release. Floating ranges are forbidden at the bundle boundary. */
export const VERIFIED_BETTER_SIDEBAR_VERSION = '0.17.1' as const

export type PaimindSidebarProviderState = 'active' | 'missing' | 'incompatible' | 'failed'

export interface PaimindSidebarProviderSnapshot {
  readonly state: PaimindSidebarProviderState
  readonly provider: 'dsh-better-sidebar'
  readonly providerVersion: typeof VERIFIED_BETTER_SIDEBAR_VERSION
  readonly contractVersion: typeof PAIMIND_SIDEBAR_CONTRACT_VERSION
  readonly error: string | null
}

/** Version-neutral render scope supplied to a PAIMind tab. */
export interface PaimindSidebarTabScope {
  readonly sessionId: string
  readonly cwd: string | undefined
  readonly workspaceId: string | undefined
  readonly visible: boolean
  readonly locale: PaimindLocaleSource
}

/** One product tab. No provider-owned props or records cross this boundary. */
export interface PaimindSidebarTabDefinition {
  readonly id: `paimind:${string}`
  readonly titleZh: string
  readonly titleEn: string
  readonly order?: number
  readonly single?: boolean
  /** Registered for programmatic opening without a permanent visible sidebar entry. */
  readonly hidden?: boolean
  readonly icon?: ReactNode
  readonly render: (scope: PaimindSidebarTabScope) => ReactNode
}

/** Version-neutral file viewer contribution owned by a PAIMind renderer package. */
export interface PaimindSidebarFileViewerDefinition {
  readonly id: `paimind:${string}`
  readonly titleZh: string
  readonly titleEn: string
  readonly extensions: readonly string[]
  readonly priority?: number
  readonly render: (props: {
    readonly path: string
    readonly title: string
    readonly mediaUrl: string | undefined
    readonly locale: PaimindLocaleSource
  }) => ReactNode
}

/** Stable service consumed by PAIMind feature packages. */
export interface PaimindSidebarService {
  getStatus(): PaimindSidebarProviderSnapshot
  subscribe(listener: () => void): () => void
  registerTab(definition: PaimindSidebarTabDefinition): () => void
  registerFileViewer(definition: PaimindSidebarFileViewerDefinition): () => void
  openTab(id: PaimindSidebarTabDefinition['id'], options?: PaimindSidebarOpenTabOptions): boolean
  /** Close one exact PAIMind-owned tab, primarily for retired-entry migration. */
  closeTab(id: PaimindSidebarTabDefinition['id']): boolean
  getFileCapability(path: string, allowedViewerIds?: readonly string[]): PaimindSidebarFileCapability
  openFile(request: PaimindSidebarOpenFileRequest): PaimindSidebarFileOpenResult
  dispose(): void
}

export interface PaimindSidebarOpenTabOptions {
  /** Per-open title used by on-demand workbenches. */
  readonly title?: string
  /** A content open reveals its landing panel through the provider's native layout contract. */
  readonly path?: string
}

export type PaimindSidebarFileCapability =
  | { readonly state: 'available'; readonly viewerId: string }
  | { readonly state: 'provider-unavailable' | 'editor-unavailable' | 'viewer-unavailable'; readonly viewerId: null }

export interface PaimindSidebarOpenFileRequest {
  readonly path: string
  readonly title?: string
  readonly allowedViewerIds?: readonly string[]
  /** Close the path-derived editor before opening so updated bytes are fetched again. */
  readonly refresh?: boolean
}

export type PaimindSidebarFileOpenResult =
  | { readonly state: 'opened'; readonly viewerId: string }
  | { readonly state: 'provider-unavailable' | 'editor-unavailable' | 'viewer-unavailable'; readonly viewerId: null }
  | { readonly state: 'failed'; readonly viewerId: null; readonly error: string }

/** Narrow external API mirror kept exclusively in this adapter package. */
export interface ExternalSidebarTabProps {
  readonly scope: { readonly sessionId: string; readonly cwd?: string }
  readonly visible: boolean
}

export interface ExternalSidebarTabDescriptor {
  readonly id: string
  readonly title: string | (() => string)
  readonly icon?: ReactNode | ((size: number) => ReactNode)
  readonly order?: number
  readonly single?: boolean
  readonly hidden?: boolean
  readonly component: (props: ExternalSidebarTabProps) => ReactNode
}

export interface ExternalSidebarFileViewerProps {
  readonly ctx?: unknown
  readonly store?: unknown
  readonly scope: { readonly sessionId: string; readonly cwd?: string }
  readonly path: string
  readonly title: string
  readonly viewerId?: string
  readonly content?: string
  readonly truncated?: boolean
  readonly mediaUrl?: string
  readonly customData?: unknown
  readonly toolbar?: 'self' | 'host'
  readonly onToolbarState?: (state: unknown) => void
  readonly onToolbarControls?: (controls: unknown) => void
}

export interface ExternalSidebarFileViewerDescriptor {
  readonly id: string
  readonly title?: string | (() => string)
  readonly icon?: ReactNode | ((size: number) => ReactNode)
  readonly exts?: readonly string[]
  readonly priority?: number
  readonly fetchStrategy?: 'none' | 'fsRead' | 'mediaUrl' | 'custom' | 'binary-download'
  readonly detect?: (path: string, head: Uint8Array) => boolean
  readonly load?: (path: string, scope: ExternalSidebarFileViewerProps['scope'], signal?: AbortSignal) => Promise<unknown>
  readonly settings?: unknown
  readonly component?: (props: ExternalSidebarFileViewerProps) => ReactNode
}

interface ExternalSidebarTabSnapshot {
  readonly id: string
  readonly type: string
  readonly title: string
  readonly path?: string
}

type ExternalSidebarSplitSnapshot =
  | { readonly kind: 'leaf'; readonly tabs: readonly ExternalSidebarTabSnapshot[] }
  | { readonly kind: 'split'; readonly children: readonly ExternalSidebarSplitSnapshot[] }

interface ExternalSidebarSnapshot {
  readonly sessionId?: string
  readonly state?: {
    readonly splits: ExternalSidebarSplitSnapshot
    readonly bottomSplits: ExternalSidebarSplitSnapshot
    readonly floats: readonly { readonly tab: ExternalSidebarTabSnapshot }[]
  }
}

export interface ExternalBetterSidebarService {
  registerTab(descriptor: ExternalSidebarTabDescriptor): () => void
  registerFileViewer?(descriptor: ExternalSidebarFileViewerDescriptor): () => void
  openTab(seed: {
    readonly type: string
    readonly title?: string
    readonly path?: string
    readonly id?: string
  }): void
  closeTab?(tabId: string): void
  updateTab?(tabId: string, patch: { readonly title?: string; readonly path?: string }): void
  getTab?(id: string): ExternalSidebarTabDescriptor | undefined
  getFileViewers?(): readonly ExternalSidebarFileViewerDescriptor[]
  isTabEnabled?(id: string): boolean
  matchFileViewer?(path: string, head?: Uint8Array): ExternalSidebarFileViewerDescriptor | undefined
  subscribe?(listener: () => void): () => void
  getSnapshot?(): ExternalSidebarSnapshot
  subscribeState?(listener: () => void): () => void
}

interface Registration {
  readonly definitions: PaimindSidebarTabDefinition[]
  readonly disposeProvider: () => void
}

interface ViewerRegistration {
  readonly definitions: PaimindSidebarFileViewerDefinition[]
  readonly disposeProvider: () => void
}

const FILE_REFRESH_REOPEN_DELAY_MS = 50

function collectPersistedEditorTabs(snapshot: ExternalSidebarSnapshot): ExternalSidebarTabSnapshot[] {
  if (snapshot.state === undefined) return []
  const tabs: ExternalSidebarTabSnapshot[] = []
  const collect = (node: ExternalSidebarSplitSnapshot): void => {
    if (node.kind === 'leaf') {
      tabs.push(...node.tabs.filter(tab => tab.type === 'editor' && tab.path !== undefined))
      return
    }
    for (const child of node.children) collect(child)
  }
  collect(snapshot.state.splits)
  collect(snapshot.state.bottomSplits)
  tabs.push(...snapshot.state.floats
    .map(entry => entry.tab)
    .filter(tab => tab.type === 'editor' && tab.path !== undefined))
  return [...new Map(tabs.map(tab => [tab.id, tab])).values()]
}

const freezeStatus = (
  state: PaimindSidebarProviderState,
  error: string | null = null,
): PaimindSidebarProviderSnapshot => Object.freeze({
  state,
  provider: 'dsh-better-sidebar',
  providerVersion: VERIFIED_BETTER_SIDEBAR_VERSION,
  contractVersion: PAIMIND_SIDEBAR_CONTRACT_VERSION,
  error,
})

function isProvider(value: unknown): value is ExternalBetterSidebarService {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as Partial<ExternalBetterSidebarService>
  return typeof candidate.registerTab === 'function' && typeof candidate.openTab === 'function'
}

/**
 * Runtime adapter with stack-safe registrations. The provider sees one descriptor
 * per id even during HMR; disposing the newest definition restores its predecessor.
 */
export class BetterSidebarAdapter implements PaimindSidebarService {
  private readonly provider: ExternalBetterSidebarService | null
  private readonly locale: PaimindLocaleSource
  private readonly projects: PaimindWorkspaceProjectService
  private status: PaimindSidebarProviderSnapshot
  private readonly listeners = new Set<() => void>()
  private readonly registrations = new Map<string, Registration>()
  private readonly viewerRegistrations = new Map<string, ViewerRegistration>()
  private readonly pendingFileOpens = new Map<string, ReturnType<typeof setTimeout>>()
  private pendingProviderRehydrate: ReturnType<typeof setTimeout> | null = null
  private disposeProviderRegistry: (() => void) | null = null
  private disposeProviderState: (() => void) | null = null
  private providerViewerFingerprint = ''
  private providerViewerRevision = 0
  private readonly rehydratedProviderStates = new Set<string>()
  private disposed = false

  constructor(
    provider: unknown,
    locale: PaimindLocaleSource,
    projects: PaimindWorkspaceProjectService,
  ) {
    this.locale = locale
    this.projects = projects
    if (provider === undefined || provider === null) {
      this.provider = null
      this.status = freezeStatus('missing')
    } else if (!isProvider(provider)) {
      this.provider = null
      this.status = freezeStatus('incompatible', 'Provider does not expose registerTab/openTab')
    } else {
      this.provider = provider
      this.status = freezeStatus('active')
      this.providerViewerFingerprint = this.fileViewerFingerprint()
      if (typeof provider.subscribe === 'function') {
        this.disposeProviderRegistry = provider.subscribe(() => { this.onProviderRegistryChange() })
      }
      if (typeof provider.subscribeState === 'function') {
        this.disposeProviderState = provider.subscribeState(() => { this.queueProviderRehydrate() })
      }
      this.queueProviderRehydrate()
    }
  }

  getStatus(): PaimindSidebarProviderSnapshot {
    return this.status
  }

  subscribe(listener: () => void): () => void {
    if (this.disposed) return () => {}
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  registerTab(definition: PaimindSidebarTabDefinition): () => void {
    if (this.disposed || this.status.state !== 'active' || this.provider === null) return () => {}
    if (!/^paimind:[a-z0-9][a-z0-9-]*$/.test(definition.id)) {
      throw new Error(`invalid PAIMind sidebar tab id "${definition.id}"`)
    }
    const frozen = Object.freeze({ ...definition })
    let registration = this.registrations.get(frozen.id)
    if (registration === undefined) {
      const definitions: PaimindSidebarTabDefinition[] = [frozen]
      try {
        const disposeProvider = this.provider.registerTab({
          id: frozen.id,
          title: () => {
            const active = definitions.at(-1) ?? frozen
            return this.locale.getLocale().active.startsWith('zh') ? active.titleZh : active.titleEn
          },
          icon: () => (definitions.at(-1) ?? frozen).icon ?? null,
          ...(frozen.order === undefined ? {} : { order: frozen.order }),
          single: frozen.single ?? true,
          ...(frozen.hidden === undefined ? {} : { hidden: frozen.hidden }),
          component: ({ scope, visible }) => {
            const active = definitions.at(-1) ?? frozen
            const project = this.projects.getSnapshot().projects
              .find(entry => entry.sessionIds.includes(scope.sessionId))
            return active.render({
              sessionId: scope.sessionId,
              cwd: scope.cwd,
              workspaceId: project?.workspaceId,
              visible,
              locale: this.locale,
            })
          },
        })
        registration = { definitions, disposeProvider }
        this.registrations.set(frozen.id, registration)
      } catch (error) {
        this.fail(error)
        return () => {}
      }
    } else {
      registration.definitions.push(frozen)
    }

    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      const current = this.registrations.get(frozen.id)
      if (current === undefined) return
      const index = current.definitions.lastIndexOf(frozen)
      if (index >= 0) current.definitions.splice(index, 1)
      if (current.definitions.length > 0) return
      this.registrations.delete(frozen.id)
      try { current.disposeProvider() } catch (error) { this.fail(error) }
    }
  }

  registerFileViewer(definition: PaimindSidebarFileViewerDefinition): () => void {
    if (this.disposed || this.status.state !== 'active' || this.provider?.registerFileViewer === undefined) return () => {}
    if (!/^paimind:[a-z0-9][a-z0-9-]*$/.test(definition.id)
      || definition.extensions.length === 0
      || definition.extensions.some(extension => !/^[a-z0-9]+$/.test(extension))) {
      throw new Error(`invalid PAIMind file viewer "${definition.id}"`)
    }
    const frozen = Object.freeze({ ...definition, extensions: Object.freeze([...definition.extensions]) })
    let registration = this.viewerRegistrations.get(frozen.id)
    if (registration === undefined) {
      const definitions: PaimindSidebarFileViewerDefinition[] = [frozen]
      try {
        const disposeProvider = this.provider.registerFileViewer({
          id: frozen.id,
          title: () => {
            const active = definitions.at(-1) ?? frozen
            return this.locale.getLocale().active.startsWith('zh') ? active.titleZh : active.titleEn
          },
          exts: frozen.extensions,
          priority: frozen.priority ?? 100,
          fetchStrategy: 'mediaUrl',
          component: ({ path, title, mediaUrl }) => (definitions.at(-1) ?? frozen).render({ path, title, mediaUrl, locale: this.locale }),
        })
        registration = { definitions, disposeProvider }
        this.viewerRegistrations.set(frozen.id, registration)
      } catch (error) {
        this.fail(error)
        return () => {}
      }
    } else {
      registration.definitions.push(frozen)
    }

    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      const current = this.viewerRegistrations.get(frozen.id)
      if (current === undefined) return
      const index = current.definitions.lastIndexOf(frozen)
      if (index >= 0) current.definitions.splice(index, 1)
      if (current.definitions.length > 0) return
      this.viewerRegistrations.delete(frozen.id)
      try { current.disposeProvider() } catch (error) { this.fail(error) }
    }
  }

  openTab(id: PaimindSidebarTabDefinition['id'], options: PaimindSidebarOpenTabOptions = {}): boolean {
    if (
      this.disposed
      || this.status.state !== 'active'
      || this.provider === null
      || !this.registrations.has(id)
      || (typeof this.provider.isTabEnabled === 'function' && !this.provider.isTabEnabled(id))
    ) return false
    try {
      this.provider.openTab({
        type: id,
        ...(options.title === undefined ? {} : { title: options.title }),
        ...(options.path === undefined ? {} : { path: options.path }),
      })
      // The provider focuses an existing single tab without replacing its
      // metadata. Keep this owned workbench's label aligned with its content.
      if (this.registrations.get(id)?.definitions.at(-1)?.single === true
        && this.provider.updateTab !== undefined && this.provider.getSnapshot !== undefined) {
        const state = this.provider.getSnapshot().state
        if (state !== undefined) {
          const collect = (node: ExternalSidebarSplitSnapshot): readonly ExternalSidebarTabSnapshot[] =>
            node.kind === 'leaf' ? node.tabs : node.children.flatMap(collect)
          const tabs = [...collect(state.splits), ...collect(state.bottomSplits), ...state.floats.map(row => row.tab)]
            .filter(tab => tab.type === id)
          const tab = tabs.length === 1 ? tabs[0] : undefined
          if (tab !== undefined && ((options.title !== undefined && options.title !== tab.title)
            || (options.path !== undefined && options.path !== tab.path))) {
            this.provider.updateTab(tab.id, {
              ...(options.title === undefined ? {} : { title: options.title }),
              ...(options.path === undefined ? {} : { path: options.path }),
            })
          }
        }
      }
      return true
    } catch (error) {
      this.fail(error)
      return false
    }
  }

  closeTab(id: PaimindSidebarTabDefinition['id']): boolean {
    if (this.disposed || this.status.state !== 'active' || this.provider?.closeTab === undefined) return false
    try {
      this.provider.closeTab(id)
      return true
    } catch (error) {
      this.fail(error)
      return false
    }
  }

  getFileCapability(path: string, allowedViewerIds?: readonly string[]): PaimindSidebarFileCapability {
    if (
      this.disposed
      || this.status.state !== 'active'
      || this.provider === null
    ) return { state: 'provider-unavailable', viewerId: null }
    if (
      typeof this.provider.getTab !== 'function'
      || typeof this.provider.isTabEnabled !== 'function'
      || this.provider.getTab('editor') === undefined
      || !this.provider.isTabEnabled('editor')
    ) return { state: 'editor-unavailable', viewerId: null }
    if (typeof this.provider.matchFileViewer !== 'function') {
      return { state: 'viewer-unavailable', viewerId: null }
    }
    const viewer = this.provider.matchFileViewer(path)
    if (
      viewer === undefined
      || (allowedViewerIds !== undefined && !allowedViewerIds.includes(viewer.id))
    ) return { state: 'viewer-unavailable', viewerId: null }
    return { state: 'available', viewerId: viewer.id }
  }

  openFile(request: PaimindSidebarOpenFileRequest): PaimindSidebarFileOpenResult {
    const capability = this.getFileCapability(request.path, request.allowedViewerIds)
    if (capability.state !== 'available') return capability
    if (this.provider === null) return { state: 'provider-unavailable', viewerId: null }
    const at = Math.max(request.path.lastIndexOf('/'), request.path.lastIndexOf('\\'))
    const title = request.title ?? (at === -1 ? request.path : request.path.slice(at + 1))
    const id = `editor:${request.path}`
    const seed = { type: 'editor', title, path: request.path, id }
    try {
      if (request.refresh === true) {
        if (typeof this.provider.closeTab !== 'function') {
          return { state: 'editor-unavailable', viewerId: null }
        }
        this.refreshProviderFile(id, seed)
        return { state: 'opened', viewerId: capability.viewerId }
      }
      this.provider.openTab(seed)
      return { state: 'opened', viewerId: capability.viewerId }
    } catch (error) {
      this.fail(error)
      return {
        state: 'failed', viewerId: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.pendingProviderRehydrate !== null) clearTimeout(this.pendingProviderRehydrate)
    this.pendingProviderRehydrate = null
    for (const timer of this.pendingFileOpens.values()) clearTimeout(timer)
    this.pendingFileOpens.clear()
    try { this.disposeProviderState?.() } catch { /* disposal remains best-effort */ }
    try { this.disposeProviderRegistry?.() } catch { /* disposal remains best-effort */ }
    this.disposeProviderState = null
    this.disposeProviderRegistry = null
    for (const registration of [...this.registrations.values()].reverse()) {
      try { registration.disposeProvider() } catch { /* disposal remains best-effort */ }
    }
    for (const registration of [...this.viewerRegistrations.values()].reverse()) {
      try { registration.disposeProvider() } catch { /* disposal remains best-effort */ }
    }
    this.registrations.clear()
    this.viewerRegistrations.clear()
    this.listeners.clear()
  }

  private refreshProviderFile(
    id: string,
    seed: { readonly type: string; readonly title?: string; readonly path?: string; readonly id?: string },
  ): void {
    if (this.provider?.closeTab === undefined) return
    this.provider.closeTab(id)
    const pending = this.pendingFileOpens.get(id)
    if (pending !== undefined) clearTimeout(pending)
    const timer = setTimeout(() => {
      this.pendingFileOpens.delete(id)
      if (this.disposed || this.status.state !== 'active' || this.provider === null) return
      try { this.provider.openTab(seed) } catch (error) { this.fail(error) }
    }, FILE_REFRESH_REOPEN_DELAY_MS)
    this.pendingFileOpens.set(id, timer)
  }

  private fileViewerFingerprint(): string {
    if (this.provider?.getFileViewers === undefined) return ''
    return this.provider.getFileViewers().map(viewer => viewer.id).sort().join('\u0000')
  }

  private onProviderRegistryChange(): void {
    if (this.disposed) return
    try {
      const fingerprint = this.fileViewerFingerprint()
      if (fingerprint === this.providerViewerFingerprint) return
      this.providerViewerFingerprint = fingerprint
      this.providerViewerRevision += 1
      this.queueProviderRehydrate()
    } catch (error) {
      this.fail(error)
    }
  }

  private queueProviderRehydrate(): void {
    if (
      this.disposed
      || this.provider?.getSnapshot === undefined
      || this.provider.matchFileViewer === undefined
      || this.provider.closeTab === undefined
    ) return
    if (this.pendingProviderRehydrate !== null) clearTimeout(this.pendingProviderRehydrate)
    this.pendingProviderRehydrate = setTimeout(() => {
      this.pendingProviderRehydrate = null
      if (this.disposed || this.provider?.getSnapshot === undefined) return
      try {
        const snapshot = this.provider.getSnapshot()
        if (snapshot.sessionId === undefined) return
        // A late viewer registration invalidates persisted editor mounts once.
        // Session changes reuse the same registry and must not close/reopen every
        // editor tab while the provider is reconciling its own React tree.
        const stateKey = String(this.providerViewerRevision)
        if (this.rehydratedProviderStates.has(stateKey)) return
        this.rehydratedProviderStates.add(stateKey)
        for (const tab of collectPersistedEditorTabs(snapshot)) {
          if (tab.path === undefined || this.provider.matchFileViewer?.(tab.path) === undefined) continue
          this.refreshProviderFile(tab.id, {
            type: 'editor', title: tab.title, path: tab.path, id: tab.id,
          })
        }
      } catch (error) {
        this.fail(error)
      }
    }, FILE_REFRESH_REOPEN_DELAY_MS)
  }

  private fail(reason: unknown): void {
    const message = reason instanceof Error ? reason.message : String(reason)
    this.status = freezeStatus('failed', message)
    for (const listener of [...this.listeners]) listener()
  }
}
