import type { ReactNode } from 'react'
import type { PaimindLocaleSource } from '@paimind/harness-compat'
import type { PaimindWorkspaceProjectService } from '@paimind/workspace-project'

/** Host half of the FP05 adapter plugin. */
export const name = 'paimind-better-sidebar-adapter'

/** The adapter is client-only; the provider's host routes stay provider-owned. */
export function apply(): void {}

/** Stable PAIMind-side contract version, independent of the provider package version. */
export const PAIMIND_SIDEBAR_CONTRACT_VERSION = 3 as const
/** Exactly verified provider release. Floating ranges are forbidden at the bundle boundary. */
export const VERIFIED_BETTER_SIDEBAR_VERSION = '0.12.1' as const

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
  openTab(id: PaimindSidebarTabDefinition['id']): boolean
  getFileCapability(path: string, allowedViewerIds?: readonly string[]): PaimindSidebarFileCapability
  openFile(request: PaimindSidebarOpenFileRequest): PaimindSidebarFileOpenResult
  dispose(): void
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
  readonly component: (props: ExternalSidebarTabProps) => ReactNode
}

export interface ExternalSidebarFileViewerDescriptor {
  readonly id: string
  readonly title?: string | (() => string)
  readonly exts?: readonly string[]
  readonly priority?: number
  readonly fetchStrategy?: 'mediaUrl'
  readonly component?: (props: {
    readonly path: string
    readonly title: string
    readonly mediaUrl?: string
  }) => ReactNode
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
  getTab?(id: string): ExternalSidebarTabDescriptor | undefined
  isTabEnabled?(id: string): boolean
  matchFileViewer?(path: string, head?: Uint8Array): ExternalSidebarFileViewerDescriptor | undefined
}

interface Registration {
  readonly definitions: PaimindSidebarTabDefinition[]
  readonly disposeProvider: () => void
}

interface ViewerRegistration {
  readonly definitions: PaimindSidebarFileViewerDefinition[]
  readonly disposeProvider: () => void
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

  openTab(id: PaimindSidebarTabDefinition['id']): boolean {
    if (
      this.disposed
      || this.status.state !== 'active'
      || this.provider === null
      || !this.registrations.has(id)
      || (typeof this.provider.isTabEnabled === 'function' && !this.provider.isTabEnabled(id))
    ) return false
    try {
      this.provider.openTab({ type: id })
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
    try {
      if (request.refresh === true) {
        if (typeof this.provider.closeTab !== 'function') {
          return { state: 'editor-unavailable', viewerId: null }
        }
        this.provider.closeTab(id)
      }
      this.provider.openTab({ type: 'editor', title, path: request.path, id })
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

  private fail(reason: unknown): void {
    const message = reason instanceof Error ? reason.message : String(reason)
    this.status = freezeStatus('failed', message)
    for (const listener of [...this.listeners]) listener()
  }
}
