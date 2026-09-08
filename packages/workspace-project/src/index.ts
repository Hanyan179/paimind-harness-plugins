import type { ProjectRef } from '@hansen/contracts'
import type {
  HarnessSessionListSnapshot,
  HarnessSessionService,
  HarnessWorkspaceListSnapshot,
  HarnessWorkspaceService,
} from '@hansen/harness-compat'

/** Host half of the FP04 UI plugin. */
export const name = 'paimind-workspace-project'

/** The host half is intentionally empty; native Workspace data stays on the Harness client runtime. */
export function apply(): void {}

/** One read-only PAIMind projection of a native Harness Workspace. */
export interface WorkspaceProjectRecord extends ProjectRef {
  readonly title: string
  readonly path: string
  readonly sessionIds: readonly string[]
  readonly visibleSessionCount: number
  readonly archivedSessionCount: number
  readonly totalSessionCount: number
  readonly createdAt: string
  readonly updatedAt: string
}

/** Observable bridge state consumed by later PAIMind feature packages. */
export interface WorkspaceProjectSnapshot {
  readonly state: 'loading' | 'ready' | 'error'
  readonly projects: readonly WorkspaceProjectRecord[]
  readonly currentSessionId: string | undefined
  readonly currentProject: WorkspaceProjectRecord | null
  readonly error: string | null
}

const freezeRecord = (
  workspace: HarnessWorkspaceListSnapshot['items'][number],
  archived: ReadonlySet<string>,
): WorkspaceProjectRecord => {
  const sessionIds = Object.freeze([...workspace.sessionIds])
  const archivedSessionCount = sessionIds.filter(id => archived.has(id)).length
  return Object.freeze({
    workspaceId: workspace.workspaceId,
    title: workspace.title,
    path: workspace.path,
    sessionIds,
    visibleSessionCount: sessionIds.length - archivedSessionCount,
    archivedSessionCount,
    totalSessionCount: sessionIds.length,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  })
}

/**
 * Project native Workspace and Session snapshots without mutating or extending them.
 * Session ownership follows the Workspace account, never a cwd/title heuristic.
 */
export function projectWorkspaceSnapshot(
  workspaces: HarnessWorkspaceListSnapshot,
  sessions: HarnessSessionListSnapshot,
): WorkspaceProjectSnapshot {
  const archived = new Set(workspaces.archivedSessionIds)
  const projects = Object.freeze(workspaces.items.map(workspace => freezeRecord(workspace, archived)))
  const currentSessionId = sessions.current
  const state = workspaces.state === 'error'
    ? 'error'
    : workspaces.baselinesReady ? 'ready' : 'loading'
  const currentProject = state !== 'ready' || currentSessionId === undefined
    ? null
    : projects.find(project => project.sessionIds.includes(currentSessionId)) ?? null
  return Object.freeze({
    state,
    projects,
    currentSessionId,
    currentProject,
    error: state === 'error' ? workspaces.error?.message ?? 'Workspace unavailable' : null,
  })
}

/** Stable outward face published as `ctx.paimindWorkspaceProject`. */
export interface PaimindWorkspaceProjectService {
  getSnapshot(): WorkspaceProjectSnapshot
  subscribe(listener: () => void): () => void
  startSession(workspaceId: string): void
  openWorkspace(workspaceId: string): Promise<void>
}

/** Cached observable adapter over the two native Harness domain stores. */
export class WorkspaceProjectBridge implements PaimindWorkspaceProjectService {
  private snapshot: WorkspaceProjectSnapshot
  private readonly listeners = new Set<() => void>()
  private readonly upstreamDisposers: Array<() => void>
  private disposed = false

  constructor(
    private readonly workspaces: HarnessWorkspaceService,
    private readonly sessions: HarnessSessionService,
  ) {
    this.snapshot = this.read()
    const refresh = (): void => {
      if (this.disposed) return
      this.snapshot = this.read()
      for (const listener of [...this.listeners]) listener()
    }
    this.upstreamDisposers = [
      this.workspaces.list.subscribe(refresh),
      this.sessions.list.subscribe(refresh),
    ]
  }

  private read(): WorkspaceProjectSnapshot {
    return projectWorkspaceSnapshot(
      this.workspaces.list.getSnapshot(),
      this.sessions.list.getSnapshot(),
    )
  }

  getSnapshot(): WorkspaceProjectSnapshot {
    return this.snapshot
  }

  subscribe(listener: () => void): () => void {
    if (this.disposed) return () => {}
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  startSession(workspaceId: string): void {
    this.requireWorkspace(workspaceId)
    this.workspaces.startSession(workspaceId)
  }

  async openWorkspace(workspaceId: string): Promise<void> {
    const workspace = this.requireWorkspace(workspaceId)
    await this.workspaces.openPath(workspace.path)
  }

  private requireWorkspace(workspaceId: string): WorkspaceProjectRecord {
    const workspace = this.snapshot.projects.find(project => project.workspaceId === workspaceId)
    if (workspace === undefined) throw new Error(`unknown Harness Workspace "${workspaceId}"`)
    return workspace
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const dispose of this.upstreamDisposers.splice(0).reverse()) dispose()
    this.listeners.clear()
  }
}
