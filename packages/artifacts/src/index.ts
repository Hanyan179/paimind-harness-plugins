import type {
  HarnessConversationSnapshot,
  HarnessSessionService,
} from '@paimind/harness-compat'
import type { PaimindWorkspaceProjectService } from '@paimind/workspace-project'
import {
  defineArtifactProjection,
  type ArtifactProducedEnvelopeV1,
  type PaimindArtifactProjectionV1,
} from '@paimind/contracts'

/** Host half of the FP06-FP07 client projection. */
export const name = 'paimind-artifacts'

/** Artifact discovery and presentation are browser projections; bytes stay provider-owned. */
export function apply(): void {}

export const PAIMIND_ARTIFACT_KINDS = ['pdf', 'pptx', 'html', 'xlsx', 'json'] as const
export type PaimindArtifactKind = typeof PAIMIND_ARTIFACT_KINDS[number]
export const PAIMIND_ARTIFACT_PREVIEW_KINDS = [
  'html-document', 'html-deck', 'bento-deck', 'spreadsheet', 'data-document',
] as const
export type PaimindArtifactPreviewKind = typeof PAIMIND_ARTIFACT_PREVIEW_KINDS[number]
export type PaimindArtifactState = 'available' | 'updating' | 'missing' | 'failed'
export type PaimindArtifactScope = 'session' | 'workspace'
export type PaimindArtifactOrigin = 'harness-deliverable' | 'paimind-product'

export interface PaimindArtifactReason {
  readonly code: string
  readonly messageZh: string
  readonly messageEn: string
}

/** Source-owned association record. No bytes or provider internals cross this contract. */
export interface PaimindArtifact {
  readonly id: string
  readonly origin: PaimindArtifactOrigin
  readonly kind: PaimindArtifactKind
  readonly state: PaimindArtifactState
  readonly title: string
  readonly path: string
  readonly sessionId: string
  readonly workspaceId: string
  readonly updatedAt: number
  readonly revision?: string
  /** Explicit product semantics only; never inferred from HTML body or model prose. */
  readonly previewKind?: PaimindArtifactPreviewKind
  /** Explicit producer-owned provenance id; never inferred from path, bytes or prose. */
  readonly traceId?: string
  /** Exact native Job correlation from the durable Artifact envelope. */
  readonly taskId?: string
  /** Generator capability id; no runtime ownership is duplicated here. */
  readonly producerId?: string
  readonly reason?: PaimindArtifactReason
}

export interface PaimindArtifactSourceSnapshot {
  readonly artifacts: readonly PaimindArtifact[]
}

export interface PaimindArtifactSource {
  readonly id: string
  getSnapshot(): PaimindArtifactSourceSnapshot
  subscribe(listener: () => void): () => void
}

export interface PaimindArtifactView extends PaimindArtifact {
  readonly sourceId: string
}

export interface PaimindArtifactDiagnostic {
  readonly sourceId: string
  readonly message: string
}

export interface PaimindArtifactSnapshot {
  readonly revision: number
  readonly artifacts: readonly PaimindArtifactView[]
  readonly diagnostics: readonly PaimindArtifactDiagnostic[]
  readonly focusedArtifactId?: string
}

export type PaimindArtifactActionResult =
  | { readonly state: 'opened' }
  | { readonly state: 'failed'; readonly messageZh: string; readonly messageEn: string }

export interface PaimindArtifactAction {
  readonly id: string
  readonly labelZh: string
  readonly labelEn: string
  supports(artifact: PaimindArtifactView): boolean
  run(artifact: PaimindArtifactView): PaimindArtifactActionResult
}

export interface PaimindArtifactActionView {
  readonly id: string
  readonly labelZh: string
  readonly labelEn: string
}

export interface PaimindArtifactService {
  getSnapshot(): PaimindArtifactSnapshot
  subscribe(listener: () => void): () => void
  registerSource(source: PaimindArtifactSource): () => void
  registerAction(action: PaimindArtifactAction): () => void
  actionsFor(artifact: PaimindArtifactView): readonly PaimindArtifactActionView[]
  runAction(actionId: string, artifact: PaimindArtifactView): PaimindArtifactActionResult
  /** Select a known Artifact for a safe cross-plugin deep link; this does not open bytes. */
  focus(artifactId: string): boolean
  dispose(): void
}

interface SourceEntry {
  readonly source: PaimindArtifactSource
  readonly disposeSubscription: () => void
}

interface ActionEntry { readonly action: PaimindArtifactAction }

const KIND_SET = new Set<string>(PAIMIND_ARTIFACT_KINDS)
const PREVIEW_KIND_SET = new Set<string>(PAIMIND_ARTIFACT_PREVIEW_KINDS)
const STATE_SET = new Set<string>(['available', 'updating', 'missing', 'failed'])
const CONTROL = /[\u0000-\u001f\u007f]/

export function kindForArtifactPath(path: string): PaimindArtifactKind | null {
  const clean = path.split(/[?#]/, 1)[0] ?? path
  const at = clean.lastIndexOf('.')
  if (at < 0) return null
  const rawExtension = clean.slice(at + 1).toLowerCase()
  const extension = rawExtension === 'htm' ? 'html' : rawExtension
  return KIND_SET.has(extension) ? extension as PaimindArtifactKind : null
}

function previewKindMatches(kind: PaimindArtifactKind, previewKind: PaimindArtifactPreviewKind): boolean {
  if (kind === 'html') return previewKind === 'html-document' || previewKind === 'html-deck' || previewKind === 'bento-deck'
  if (kind === 'xlsx') return previewKind === 'spreadsheet'
  if (kind === 'json') return previewKind === 'data-document'
  return false
}

const normalizeArtifact = (artifact: PaimindArtifact, sourceId: string): PaimindArtifactView => {
  if (artifact.id.trim() === '' || CONTROL.test(artifact.id)) throw new Error('artifact id is empty or contains control characters')
  if (!KIND_SET.has(artifact.kind)) throw new Error(`unsupported artifact kind "${artifact.kind}"`)
  if (!STATE_SET.has(artifact.state)) throw new Error(`unsupported artifact state "${artifact.state}"`)
  if (artifact.title.trim() === '') throw new Error(`artifact "${artifact.id}" has no title`)
  if (artifact.path.trim() === '' || CONTROL.test(artifact.path)) throw new Error(`artifact "${artifact.id}" has an invalid path`)
  if (artifact.sessionId.trim() === '' || artifact.workspaceId.trim() === '') {
    throw new Error(`artifact "${artifact.id}" lacks explicit Session/Workspace association`)
  }
  if (!Number.isFinite(artifact.updatedAt)) throw new Error(`artifact "${artifact.id}" has an invalid timestamp`)
  const pathKind = kindForArtifactPath(artifact.path)
  if (pathKind !== artifact.kind) throw new Error(`artifact "${artifact.id}" kind does not match its path`)
  if (
    artifact.previewKind !== undefined
    && (!PREVIEW_KIND_SET.has(artifact.previewKind) || !previewKindMatches(artifact.kind, artifact.previewKind))
  ) throw new Error(`artifact "${artifact.id}" preview kind does not match its file kind`)
  if (artifact.traceId !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(artifact.traceId)) {
    throw new Error(`artifact "${artifact.id}" has an invalid trace id`)
  }
  if (artifact.taskId !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(artifact.taskId)) {
    throw new Error(`artifact "${artifact.id}" has an invalid task id`)
  }
  if (artifact.producerId !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(artifact.producerId)) {
    throw new Error(`artifact "${artifact.id}" has an invalid producer id`)
  }
  if ((artifact.state === 'missing' || artifact.state === 'failed') && artifact.reason === undefined) {
    throw new Error(`artifact "${artifact.id}" requires a structured reason`)
  }
  return Object.freeze({
    ...artifact,
    sourceId,
    ...(artifact.reason === undefined ? {} : { reason: Object.freeze({ ...artifact.reason }) }),
  })
}

const EMPTY_SNAPSHOT: PaimindArtifactSnapshot = Object.freeze({
  revision: 0,
  artifacts: Object.freeze([]),
  diagnostics: Object.freeze([]),
})

const stateOrder: Readonly<Record<PaimindArtifactState, number>> = {
  available: 0,
  updating: 1,
  missing: 2,
  failed: 3,
}

export function orderArtifactViews(artifacts: readonly PaimindArtifactView[]): readonly PaimindArtifactView[] {
  return Object.freeze([...artifacts].sort((left, right) => (
    stateOrder[left.state] - stateOrder[right.state]
    || right.updatedAt - left.updatedAt
    || left.sourceId.localeCompare(right.sourceId)
    || left.id.localeCompare(right.id)
  )))
}

/** Scope only by explicit native identifiers; names, paths and prose never infer ownership. */
export function selectArtifactViews(
  artifacts: readonly PaimindArtifactView[],
  scope: PaimindArtifactScope,
  sessionId: string | undefined,
  workspaceId: string | undefined,
): readonly PaimindArtifactView[] {
  if (scope === 'session') return sessionId === undefined
    ? Object.freeze([])
    : Object.freeze(artifacts.filter(artifact => artifact.sessionId === sessionId))
  return workspaceId === undefined
    ? Object.freeze([])
    : Object.freeze(artifacts.filter(artifact => artifact.workspaceId === workspaceId))
}

export type ArtifactPathFailureCode =
  | 'empty-path'
  | 'invalid-workspace-root'
  | 'control-character'
  | 'unsupported-scheme'
  | 'traversal'
  | 'outside-workspace'
  | 'unsupported-kind'

export type ArtifactPathResolution =
  | { readonly state: 'safe'; readonly path: string; readonly kind: PaimindArtifactKind }
  | { readonly state: 'unsafe'; readonly code: ArtifactPathFailureCode }

function normalizedAbsolute(input: string): string | null {
  const slash = input.replace(/\\/g, '/')
  const drive = slash.match(/^([A-Za-z]):\//)
  const isPosix = slash.startsWith('/')
  if (!isPosix && drive === null) return null
  const root = drive === null ? '/' : `${drive[1]?.toUpperCase()}:/`
  const tail = drive === null ? slash.slice(1) : slash.slice(3)
  const parts: string[] = []
  for (const part of tail.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) return null
      parts.pop()
    } else {
      parts.push(part)
    }
  }
  return `${root}${parts.join('/')}`.replace(/\/$/, parts.length === 0 ? '/' : '')
}

/** Resolve only supported Workspace-contained files; the provider receives no unchecked path. */
export function resolveArtifactPath(cwd: string | undefined, path: string): ArtifactPathResolution {
  if (path.trim() === '') return { state: 'unsafe', code: 'empty-path' }
  if (CONTROL.test(path)) return { state: 'unsafe', code: 'control-character' }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(path) && !/^[A-Za-z]:[\\/]/.test(path)) {
    return { state: 'unsafe', code: 'unsupported-scheme' }
  }
  if (path.replace(/\\/g, '/').split('/').includes('..')) return { state: 'unsafe', code: 'traversal' }
  if (cwd === undefined || CONTROL.test(cwd)) return { state: 'unsafe', code: 'invalid-workspace-root' }
  const root = normalizedAbsolute(cwd)
  if (root === null) return { state: 'unsafe', code: 'invalid-workspace-root' }
  const absolute = normalizedAbsolute(path) ?? normalizedAbsolute(`${root}/${path}`)
  if (absolute === null) return { state: 'unsafe', code: 'outside-workspace' }
  const insensitive = /^[A-Za-z]:\//.test(root)
  const left = insensitive ? absolute.toLowerCase() : absolute
  const right = insensitive ? root.toLowerCase() : root
  if (left !== right && !left.startsWith(`${right.replace(/\/$/, '')}/`)) {
    return { state: 'unsafe', code: 'outside-workspace' }
  }
  const kind = kindForArtifactPath(absolute)
  if (kind === null) return { state: 'unsafe', code: 'unsupported-kind' }
  return { state: 'safe', path: absolute, kind }
}

/** Public Harness deliverables value shape; mutation ownership stays with the native plugin. */
interface HarnessDeliverablesValue {
  readonly produced?: readonly { readonly seq?: unknown; readonly path?: unknown }[]
}

export interface HarnessArtifactExtractionInput {
  readonly snapshot: HarnessConversationSnapshot
  readonly sessionId: string
  readonly workspaceId: string
  readonly updatedAt: number
}

/** Read native Turn data, never parsing prose/tool names/HTML, and keep only supported file kinds. */
export function extractHarnessArtifacts(input: HarnessArtifactExtractionInput): readonly PaimindArtifact[] {
  const timeline = input.snapshot.chat?.timeline
  if (timeline === undefined) return Object.freeze([])
  const byPath = new Map<string, PaimindArtifact>()
  for (const turn of timeline.turnOrder) {
    const value = timeline.turns.get(turn)?.data.get('deliverables') as HarnessDeliverablesValue | undefined
    if (!Array.isArray(value?.produced)) continue
    for (const produced of value.produced) {
      if (typeof produced.path !== 'string' || typeof produced.seq !== 'number') continue
      const kind = kindForArtifactPath(produced.path)
      if (kind === null) continue
      const slash = produced.path.replace(/\\/g, '/')
      const title = slash.slice(slash.lastIndexOf('/') + 1)
      byPath.set(produced.path, Object.freeze({
        id: `harness:${input.sessionId}:${produced.path}`,
        origin: 'harness-deliverable',
        kind,
        state: 'available',
        title,
        path: produced.path,
        sessionId: input.sessionId,
        workspaceId: input.workspaceId,
        updatedAt: input.updatedAt,
        revision: String(produced.seq),
        ...(kind === 'html' ? { previewKind: 'html-document' as const } : {}),
        ...(kind === 'xlsx' ? { previewKind: 'spreadsheet' as const } : {}),
      }))
    }
  }
  return Object.freeze([...byPath.values()])
}

/** Observable, non-persistent projection over producer-owned artifact sources. */
export class ArtifactRegistry implements PaimindArtifactService {
  private snapshot: PaimindArtifactSnapshot = EMPTY_SNAPSHOT
  private readonly sources = new Map<string, SourceEntry[]>()
  private readonly actions = new Map<string, ActionEntry[]>()
  private readonly listeners = new Set<() => void>()
  private disposed = false

  getSnapshot(): PaimindArtifactSnapshot { return this.snapshot }

  subscribe(listener: () => void): () => void {
    if (this.disposed) return () => {}
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  registerSource(source: PaimindArtifactSource): () => void {
    if (this.disposed) return () => {}
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(source.id)) throw new Error(`invalid artifact source id "${source.id}"`)
    const entry: SourceEntry = {
      source,
      disposeSubscription: source.subscribe(() => { this.publish() }),
    }
    const stack = this.sources.get(source.id) ?? []
    stack.push(entry)
    this.sources.set(source.id, stack)
    this.publish()
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      entry.disposeSubscription()
      const current = this.sources.get(source.id)
      if (current === undefined) return
      const index = current.lastIndexOf(entry)
      if (index >= 0) current.splice(index, 1)
      if (current.length === 0) this.sources.delete(source.id)
      this.publish()
    }
  }

  registerAction(action: PaimindArtifactAction): () => void {
    if (this.disposed) return () => {}
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(action.id)) throw new Error(`invalid artifact action id "${action.id}"`)
    if (action.labelZh.trim() === '' || action.labelEn.trim() === '') throw new Error(`artifact action "${action.id}" lacks labels`)
    const entry: ActionEntry = { action }
    const stack = this.actions.get(action.id) ?? []
    stack.push(entry)
    this.actions.set(action.id, stack)
    this.publish()
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      const current = this.actions.get(action.id)
      if (current === undefined) return
      const index = current.lastIndexOf(entry)
      if (index >= 0) current.splice(index, 1)
      if (current.length === 0) this.actions.delete(action.id)
      this.publish()
    }
  }

  actionsFor(artifact: PaimindArtifactView): readonly PaimindArtifactActionView[] {
    if (this.disposed) return Object.freeze([])
    const views: PaimindArtifactActionView[] = []
    for (const [id, stack] of this.actions) {
      const action = stack.at(-1)?.action
      if (action === undefined) continue
      try {
        if (action.supports(artifact)) views.push(Object.freeze({ id, labelZh: action.labelZh, labelEn: action.labelEn }))
      } catch { /* A contributor predicate cannot break the Artifact list. */ }
    }
    return Object.freeze(views)
  }

  runAction(actionId: string, artifact: PaimindArtifactView): PaimindArtifactActionResult {
    const action = this.actions.get(actionId)?.at(-1)?.action
    if (this.disposed || action === undefined) return {
      state: 'failed', messageZh: '这个产物动作不可用。', messageEn: 'This artifact action is unavailable.',
    }
    try {
      if (!action.supports(artifact)) throw new Error('action does not support this artifact')
      return action.run(artifact)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { state: 'failed', messageZh: `产物动作失败：${message}`, messageEn: `Artifact action failed: ${message}` }
    }
  }

  focus(artifactId: string): boolean {
    if (this.disposed || !this.snapshot.artifacts.some(artifact => artifact.id === artifactId)) return false
    if (this.snapshot.focusedArtifactId === artifactId) return true
    this.snapshot = Object.freeze({ ...this.snapshot, revision: this.snapshot.revision + 1, focusedArtifactId: artifactId })
    for (const listener of [...this.listeners]) listener()
    return true
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const stack of this.sources.values()) {
      for (const entry of stack) entry.disposeSubscription()
    }
    this.sources.clear()
    this.actions.clear()
    this.listeners.clear()
    this.snapshot = EMPTY_SNAPSHOT
  }

  private publish(): void {
    if (this.disposed) return
    const artifacts: PaimindArtifactView[] = []
    const diagnostics: PaimindArtifactDiagnostic[] = []
    for (const [sourceId, stack] of this.sources) {
      const source = stack.at(-1)?.source
      if (source === undefined) continue
      try {
        const snapshot = source.getSnapshot()
        if (!Array.isArray(snapshot.artifacts)) throw new Error('source snapshot does not contain an artifact array')
        artifacts.push(...snapshot.artifacts.map(artifact => normalizeArtifact(artifact, sourceId)))
      } catch (error) {
        diagnostics.push(Object.freeze({
          sourceId,
          message: error instanceof Error ? error.message : String(error),
        }))
      }
    }
    const byLocation = new Map<string, PaimindArtifactView>()
    for (const artifact of artifacts) {
      const key = `${artifact.sessionId}\0${artifact.path}`
      const prior = byLocation.get(key)
      if (prior === undefined
        || (prior.origin !== 'paimind-product' && artifact.origin === 'paimind-product')
        || (prior.origin === artifact.origin && artifact.updatedAt > prior.updatedAt)) {
        byLocation.set(key, artifact)
      }
    }
    const focusedArtifactId = this.snapshot.focusedArtifactId !== undefined
      && [...byLocation.values()].some(artifact => artifact.id === this.snapshot.focusedArtifactId)
      ? this.snapshot.focusedArtifactId
      : undefined
    this.snapshot = Object.freeze({
      revision: this.snapshot.revision + 1,
      artifacts: orderArtifactViews([...byLocation.values()]),
      diagnostics: Object.freeze(diagnostics),
      ...(focusedArtifactId === undefined ? {} : { focusedArtifactId }),
    })
    for (const listener of [...this.listeners]) listener()
  }
}

function artifactFromEnvelope(envelope: Readonly<ArtifactProducedEnvelopeV1>): Readonly<PaimindArtifact> {
  const kind: PaimindArtifactKind = envelope.kind === 'bento' ? 'html' : envelope.kind
  const previewKind = envelope.previewKind === 'presentation' || envelope.previewKind === 'pdf'
    ? undefined
    : envelope.previewKind
  const unavailable = envelope.state !== 'available'
  return Object.freeze({
    id: envelope.artifactId,
    origin: 'paimind-product',
    kind,
    state: envelope.state === 'available' ? 'available' : 'failed',
    title: envelope.title,
    path: envelope.path,
    sessionId: envelope.sessionId,
    workspaceId: envelope.workspaceId,
    updatedAt: envelope.producedAt,
    revision: String(envelope.revision),
    ...(previewKind === undefined ? {} : { previewKind }),
    ...(envelope.traceId === undefined ? {} : { traceId: envelope.traceId }),
    taskId: envelope.taskId,
    producerId: envelope.producerId,
    ...(unavailable ? { reason: {
      code: envelope.error?.code ?? envelope.state,
      messageZh: envelope.error?.message ?? '这个产物已不可用。',
      messageEn: envelope.error?.message ?? 'This artifact is no longer available.',
    } } : {}),
  })
}

/** Durable PAIMind source: native Host projection is the only state and replay owner. */
export class HarnessProjectedArtifactSource implements PaimindArtifactSource {
  readonly id = 'paimind:artifact-projection'
  private readonly listeners = new Set<() => void>()
  private readonly cached = new Map<string, readonly PaimindArtifact[]>()
  private snapshot: PaimindArtifactSourceSnapshot = Object.freeze({ artifacts: Object.freeze([]) })
  private currentId: string | undefined
  private disposeCurrent: () => void = () => {}
  private readonly disposeList: () => void
  private readonly disposeProjects: () => void
  private disposed = false

  constructor(
    private readonly sessions: HarnessSessionService,
    private readonly projects: PaimindWorkspaceProjectService,
  ) {
    this.disposeList = sessions.list.subscribe(() => { this.rebind() })
    this.disposeProjects = projects.subscribe(() => { this.refreshCurrent() })
    this.rebind()
  }

  getSnapshot(): PaimindArtifactSourceSnapshot { return this.snapshot }
  subscribe(listener: () => void): () => void {
    if (this.disposed) return () => {}
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.disposeCurrent()
    this.disposeList()
    this.disposeProjects()
    this.cached.clear()
    this.listeners.clear()
  }

  private rebind(): void {
    if (this.disposed) return
    const next = this.sessions.list.getSnapshot().current
    if (next === this.currentId) { this.refreshCurrent(); return }
    this.disposeCurrent()
    this.disposeCurrent = () => {}
    this.currentId = next
    if (next !== undefined) {
      const face = this.sessions.binding?.(next)?.session.projections?.faceOf('paimind.artifacts')
      if (face !== undefined) this.disposeCurrent = face.subscribe(() => { this.refreshCurrent() })
    }
    this.refreshCurrent()
  }

  private refreshCurrent(): void {
    if (this.disposed) return
    const sessionId = this.currentId
    if (sessionId !== undefined) {
      const binding = this.sessions.binding?.(sessionId)
      const project = this.projects.getSnapshot().projects.find(entry => entry.sessionIds.includes(sessionId))
      const value = binding?.session.projections?.faceOf('paimind.artifacts').getSnapshot()
      if (project !== undefined && value !== undefined) {
        try {
          const projection = defineArtifactProjection(value as PaimindArtifactProjectionV1)
          this.cached.set(sessionId, Object.freeze(projection.artifacts
            .filter(entry => entry.sessionId === sessionId && entry.workspaceId === project.workspaceId)
            .map(artifactFromEnvelope)))
        } catch {
          this.cached.set(sessionId, Object.freeze([]))
        }
      } else {
        this.cached.set(sessionId, Object.freeze([]))
      }
    }
    this.snapshot = Object.freeze({ artifacts: Object.freeze([...this.cached.values()].flat()) })
    for (const listener of [...this.listeners]) listener()
  }
}

/** Native source caches only Session snapshots the user has actually staged. */
export class HarnessDeliverableArtifactSource implements PaimindArtifactSource {
  readonly id = 'harness:deliverables'
  private readonly listeners = new Set<() => void>()
  private readonly cached = new Map<string, readonly PaimindArtifact[]>()
  private snapshot: PaimindArtifactSourceSnapshot = Object.freeze({ artifacts: Object.freeze([]) })
  private currentId: string | undefined
  private disposeCurrent: () => void = () => {}
  private readonly disposeList: () => void
  private readonly disposeProjects: () => void
  private disposed = false

  constructor(
    private readonly sessions: HarnessSessionService,
    private readonly projects: PaimindWorkspaceProjectService,
  ) {
    this.disposeList = sessions.list.subscribe(() => { this.rebind() })
    this.disposeProjects = projects.subscribe(() => { this.refreshCurrent() })
    this.rebind()
  }

  getSnapshot(): PaimindArtifactSourceSnapshot { return this.snapshot }

  subscribe(listener: () => void): () => void {
    if (this.disposed) return () => {}
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.disposeCurrent()
    this.disposeList()
    this.disposeProjects()
    this.cached.clear()
    this.listeners.clear()
  }

  private rebind(): void {
    if (this.disposed) return
    const next = this.sessions.list.getSnapshot().current
    if (next === this.currentId) {
      this.refreshCurrent()
      return
    }
    this.disposeCurrent()
    this.disposeCurrent = () => {}
    this.currentId = next
    if (next !== undefined) {
      const session = this.sessions.binding?.(next)?.session
      if (session !== undefined) this.disposeCurrent = session.subscribe(() => { this.refreshCurrent() })
    }
    this.refreshCurrent()
  }

  private refreshCurrent(): void {
    if (this.disposed) return
    const sessionId = this.currentId
    if (sessionId !== undefined) {
      const binding = this.sessions.binding?.(sessionId)
      const summary = this.sessions.list.getSnapshot().byId[sessionId]
      const project = this.projects.getSnapshot().projects.find(entry => entry.sessionIds.includes(sessionId))
      if (binding !== undefined && summary !== undefined && project !== undefined) {
        this.cached.set(sessionId, extractHarnessArtifacts({
          snapshot: binding.session.getSnapshot(),
          sessionId,
          workspaceId: project.workspaceId,
          updatedAt: summary.updatedAt ?? Date.now(),
        }))
      }
    }
    this.snapshot = Object.freeze({ artifacts: Object.freeze([...this.cached.values()].flat()) })
    for (const listener of [...this.listeners]) listener()
  }
}
