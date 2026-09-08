import { Component, createElement, createRef, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { PaimindClientContext } from '@hansen/harness-compat'
import type { PaimindWorkspaceProjectService } from '@hansen/workspace-project'
import {
  BetterSidebarAdapter,
  type ExternalBetterSidebarService,
  type ExternalSidebarFileViewerDescriptor,
  type ExternalSidebarFileViewerProps,
} from '../index.js'

/** Provider and PAIMind services required before the adapter activates. */
export const inject = ['betterSidebar', 'locale', 'paimindWorkspaceProject']

export interface BetterSidebarAdapterClientContext extends PaimindClientContext {
  readonly betterSidebar: ExternalBetterSidebarService
  readonly paimindWorkspaceProject: PaimindWorkspaceProjectService
}

type ExternalFileViewerComponent = NonNullable<ExternalSidebarFileViewerDescriptor['component']>

interface StableFileViewerProps {
  readonly component: ExternalFileViewerComponent
  readonly viewerProps: ExternalSidebarFileViewerProps
}

const officeLifecycleNodes = new WeakSet<Node>()
const OFFICE_CLEANUP_GUARD_GRACE_MS = 250
let officeCleanupGuardUsers = 0
let originalRemoveChild: typeof Node.prototype.removeChild | null = null
let cleanupGuardRestoreTimer: ReturnType<typeof setTimeout> | null = null

export function markOfficeLifecycleTree(node: Node): void {
  officeLifecycleNodes.add(node)
  for (const child of node.childNodes) markOfficeLifecycleTree(child)
}

/** Make already-completed removals idempotent only inside a tracked Office tree. */
export function installOfficeDomCleanupGuard(): () => void {
  if (typeof Node === 'undefined') return () => {}
  if (cleanupGuardRestoreTimer !== null) {
    clearTimeout(cleanupGuardRestoreTimer)
    cleanupGuardRestoreTimer = null
  }
  officeCleanupGuardUsers += 1
  if (originalRemoveChild === null) {
    originalRemoveChild = Node.prototype.removeChild
    Node.prototype.removeChild = function removeOfficeChild<T extends Node>(child: T): T {
      if (
        child.parentNode !== this
        && (officeLifecycleNodes.has(this) || officeLifecycleNodes.has(child))
      ) return child
      return originalRemoveChild!.call(this, child) as T
    }
  }
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    officeCleanupGuardUsers -= 1
    if (officeCleanupGuardUsers !== 0 || originalRemoveChild === null) return
    // React removes the outer tab subtree after child componentWillUnmount
    // returns. Keep the tracked-tree guard alive for that same cleanup turn;
    // restoring it synchronously leaves the provider's duplicate removal
    // exposed even though the Office boundary was marked correctly.
    cleanupGuardRestoreTimer = setTimeout(() => {
      cleanupGuardRestoreTimer = null
      if (officeCleanupGuardUsers !== 0 || originalRemoveChild === null) return
      Node.prototype.removeChild = originalRemoveChild
      originalRemoveChild = null
    }, OFFICE_CLEANUP_GUARD_GRACE_MS)
  }
}

/** Keep one persisted editor mount bound to the scope that originally loaded its bytes. */
export class SessionStableFileViewer extends Component<StableFileViewerProps> {
  private readonly stableScope = this.props.viewerProps.scope
  private readonly hostRef = createRef<HTMLDivElement>()
  private viewerRoot: Root | null = null
  private lifecycleObserver: MutationObserver | null = null
  private disposeCleanupGuard: (() => void) | null = null

  override componentDidMount(): void {
    const host = this.hostRef.current
    if (host === null) return
    this.disposeCleanupGuard = installOfficeDomCleanupGuard()
    markOfficeLifecycleTree(host)
    this.lifecycleObserver = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) markOfficeLifecycleTree(node)
      }
    })
    this.lifecycleObserver.observe(host, { childList: true, subtree: true })
    this.viewerRoot = createRoot(host)
    this.renderViewer()
  }

  override componentDidUpdate(): void {
    this.renderViewer()
  }

  override componentWillUnmount(): void {
    // The external Office viewer owns an imperative React/DOM subtree. Finish
    // its cleanup while this boundary is still attached, before the Harness
    // root removes the boundary host from its own tree.
    this.viewerRoot?.unmount()
    this.viewerRoot = null
    this.lifecycleObserver?.disconnect()
    this.lifecycleObserver = null
    this.disposeCleanupGuard?.()
    this.disposeCleanupGuard = null
  }

  private renderViewer(): void {
    this.viewerRoot?.render(createElement(this.props.component, {
      ...this.props.viewerProps,
      scope: this.stableScope,
    }))
  }

  override render(): ReactNode {
    return createElement('div', {
      ref: this.hostRef,
      'data-paimind-office-lifecycle-boundary': this.props.viewerProps.viewerId ?? 'office',
      style: { display: 'contents' },
    })
  }
}

interface ViewerComponentReplacement {
  readonly original: ExternalFileViewerComponent
  readonly replacement: ExternalFileViewerComponent
}

const OFFICE_VIEWER_IDS = new Set(['docx', 'xlsx', 'pptx'])

function isOfficeViewer(
  viewer: ExternalSidebarFileViewerDescriptor,
): viewer is ExternalSidebarFileViewerDescriptor & { component: ExternalFileViewerComponent } {
  return OFFICE_VIEWER_IDS.has(viewer.id)
    && viewer.exts?.length === 1
    && viewer.exts[0] === viewer.id
    && viewer.fetchStrategy === 'mediaUrl'
    && typeof viewer.component === 'function'
}

/**
 * Better Sidebar keeps editor tabs across Harness Session changes. Office 0.1.2
 * includes the active Session in each viewer effect dependency and imperatively
 * clears provider-owned DOM during cleanup. Preserve the provider descriptor id
 * and settings row while adapting only its component scope at this boundary.
 */
export function stabilizeOfficeFileViewerScopes(provider: ExternalBetterSidebarService): () => void {
  if (provider.getFileViewers === undefined) return () => {}
  const replacements = new Map<ExternalSidebarFileViewerDescriptor, ViewerComponentReplacement>()

  const sync = (): void => {
    for (const viewer of provider.getFileViewers?.() ?? []) {
      if (!isOfficeViewer(viewer) || replacements.has(viewer)) continue
      const original = viewer.component
      const replacement: ExternalFileViewerComponent = viewerProps => createElement(SessionStableFileViewer, {
        component: original,
        viewerProps,
      })
      ;(viewer as { component: ExternalFileViewerComponent }).component = replacement
      replacements.set(viewer, { original, replacement })
    }
  }

  sync()
  const unsubscribe = provider.subscribe?.(sync) ?? (() => {})
  return () => {
    unsubscribe()
    for (const [viewer, replacement] of replacements) {
      if (viewer.component === replacement.replacement) {
        ;(viewer as { component: ExternalFileViewerComponent }).component = replacement.original
      }
    }
    replacements.clear()
  }
}

/** Publish one stable service and attach all provider registrations to its lifecycle. */
export function apply(ctx: BetterSidebarAdapterClientContext): void {
  ctx.effect(
    () => stabilizeOfficeFileViewerScopes(ctx.betterSidebar),
    'paimind-better-sidebar-adapter: stable Office viewer scope',
  )
  const adapter = new BetterSidebarAdapter(
    ctx.betterSidebar,
    ctx.locale,
    ctx.paimindWorkspaceProject,
  )
  ctx.effect(() => {
    const disposeService = ctx.reflect.provide('paimindSidebar', adapter)
    return () => {
      adapter.dispose()
      void disposeService()
    }
  }, 'paimind-better-sidebar-adapter: service')
}
