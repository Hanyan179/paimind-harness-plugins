import type { ReactNode } from 'react'
import type { PaimindSidebarTabScope } from '@paimind/better-sidebar-adapter'

export const BENTO_INFO_PATH = '/paimind/bento-sandbox/info'

export interface PaimindBentoPreviewRequest {
  readonly sessionId: string
  readonly workspaceId: string
  readonly cwd: string
  readonly path: string
  readonly title: string
  /** Exact Artifact identity lets an inspector activate its matching Sidecar without path inference. */
  readonly artifactSourceId?: string
  readonly artifactId?: string
  readonly traceId?: string
}

export type PaimindBentoMode = 'preview' | 'edit' | 'trace'
export type PaimindBentoRuntimeEventType = 'paimind:bento-ready' | 'paimind:bento-manifest' | 'paimind:bento-slide' | 'paimind:bento-select' | 'paimind:bento-exit'
export type PaimindBentoSelector =
  | { readonly kind: 'object' }
  | { readonly kind: 'chart-point'; readonly seriesKey: string; readonly categoryKey: string }
  | { readonly kind: 'table-cell'; readonly rowKey: string; readonly columnKey: string }

export interface PaimindBentoRuntimeEvent {
  readonly type: PaimindBentoRuntimeEventType
  readonly mode: PaimindBentoMode
  readonly slide: number
  readonly slideId?: string
  readonly objectId?: string
  readonly factId?: string
  readonly selector?: PaimindBentoSelector
  readonly slides?: readonly PaimindBentoSlideNavigationItem[]
}

export interface PaimindBentoFocusTarget {
  readonly slideId: string
  readonly objectId: string
  readonly selector: PaimindBentoSelector
}

export interface PaimindBentoSlideTarget {
  readonly slideId: string
  readonly slide: number
}

export interface PaimindBentoSlideNavigationItem {
  readonly slideId: string
  readonly title: string
}

export interface PaimindBentoSlideNavigation {
  readonly slides: readonly PaimindBentoSlideNavigationItem[]
}

export interface PaimindBentoInspectorContribution {
  readonly id: string
  /** Select and validate inspector state for this exact preview request before trace mode opens. */
  activate?(request: PaimindBentoPreviewRequest): boolean
  /** Optional, renderer-neutral outline used by the Bento workbench's slide rail. */
  getSlideNavigation?(): PaimindBentoSlideNavigation | null
  render(scope: PaimindSidebarTabScope): ReactNode
}

export interface PaimindBentoPreviewSnapshot {
  readonly revision: number
  readonly requestRevision: number
  readonly request: PaimindBentoPreviewRequest | null
  readonly runtimeEvent: PaimindBentoRuntimeEvent | null
  readonly slides: readonly PaimindBentoSlideNavigationItem[]
  readonly mode: PaimindBentoMode
  readonly focusRevision: number
  readonly focus: PaimindBentoFocusTarget | null
  readonly slideTargetRevision: number
  readonly slideTarget: PaimindBentoSlideTarget | null
  readonly inspectorRevision: number
}

export interface PaimindBentoPreviewService {
  getSnapshot(): PaimindBentoPreviewSnapshot
  subscribe(listener: () => void): () => void
  open(request: PaimindBentoPreviewRequest): boolean
  setMode(mode: PaimindBentoMode): boolean
  navigate(target: PaimindBentoSlideTarget): boolean
  focus(target: PaimindBentoFocusTarget): boolean
  registerInspector(contribution: PaimindBentoInspectorContribution): () => void
  getInspector(): PaimindBentoInspectorContribution | null
}

export interface BentoSandboxInfo {
  readonly origin: string
  readonly token: string
}
