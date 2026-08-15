export const BENTO_INFO_PATH = '/paimind/bento-sandbox/info'

export interface PaimindBentoPreviewRequest {
  readonly sessionId: string
  readonly workspaceId: string
  readonly cwd: string
  readonly path: string
  readonly title: string
}

export type PaimindBentoRuntimeEventType = 'paimind:bento-ready' | 'paimind:bento-slide' | 'paimind:bento-exit'

export interface PaimindBentoRuntimeEvent {
  readonly type: PaimindBentoRuntimeEventType
  readonly mode: 'edit' | 'present'
  readonly slide: number
}

export interface PaimindBentoPreviewSnapshot {
  readonly revision: number
  readonly requestRevision: number
  readonly request: PaimindBentoPreviewRequest | null
  readonly runtimeEvent: PaimindBentoRuntimeEvent | null
}

export interface PaimindBentoPreviewService {
  getSnapshot(): PaimindBentoPreviewSnapshot
  subscribe(listener: () => void): () => void
  open(request: PaimindBentoPreviewRequest): boolean
}

export interface BentoSandboxInfo {
  readonly origin: string
  readonly token: string
}
