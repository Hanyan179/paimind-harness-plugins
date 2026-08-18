import {
  defineArtifactProjection,
  PAIMIND_ARTIFACT_JOB_KIND,
  type ArtifactProducedEnvelopeV1,
  type PaimindArtifactProjectionV1,
} from '@paimind/contracts'
import type {
  HarnessConversationSnapshot,
  HarnessNativeJobView,
  HarnessSessionHistoryEvent,
  HarnessSessionListSnapshot,
  HarnessToolCallBlock,
  HarnessToolCallView,
} from '@paimind/harness-compat'

export const name = 'paimind-task-monitor'
export const TASK_MONITOR_RESOURCES_SCHEMA = 'paimind.task-monitor-resources/v1'

/** Host state remains in Harness; this package stores no Task Monitor state. */
export function apply(): void {}

export interface TaskMonitorResourceHistoryV1 {
  readonly schema: typeof TASK_MONITOR_RESOURCES_SCHEMA
  readonly capturedThroughSeq: number | null
  readonly skills: readonly string[]
  readonly mcps: readonly string[]
  readonly todoSnapshots: readonly TaskMonitorTodoSnapshotV1[]
}

export interface PaimindArtifactJobView extends HarnessNativeJobView {
  readonly artifact?: Readonly<ArtifactProducedEnvelopeV1>
}

export type TaskMonitorOverallStatus = 'blocked' | 'waiting' | 'running' | 'paused' | 'complete' | 'idle'
export type TaskMonitorTodoStatus = 'pending' | 'in_progress' | 'completed'
export type TaskMonitorWorkflowStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'

export interface TaskMonitorGoalView {
  readonly id: string
  readonly objective: string
  readonly phase: 'active' | 'paused' | 'blocked' | 'complete'
  readonly roundsStarted: number
  readonly maxGoalRounds: number
  readonly blockedReason?: string
  readonly updatedAt: number
}

export interface TaskMonitorTodoView {
  readonly content: string
  readonly status: TaskMonitorTodoStatus
}

export interface TaskMonitorTodoSnapshotV1 {
  readonly seq: number
  readonly time?: number
  readonly todos: readonly TaskMonitorTodoView[]
}

/** A read-only group derived from native Todo snapshots; it is never persisted as a second Todo object. */
export interface TaskMonitorTodoListView {
  readonly id: string
  readonly items: readonly TaskMonitorTodoView[]
  readonly progress: { readonly completed: number; readonly total: number }
  readonly revisionCount: number
  readonly firstSeq?: number
  readonly lastSeq?: number
  readonly current: boolean
}

export interface TaskMonitorPlanView {
  readonly active: boolean
  readonly pending: boolean
}

export interface TaskMonitorWorkflowMemberView {
  readonly label: string
  readonly childId: string
  readonly status: TaskMonitorWorkflowStatus
}

export interface TaskMonitorWorkflowView {
  readonly name: string
  readonly status: TaskMonitorWorkflowStatus
  readonly phases: readonly {
    readonly key: string
    readonly phase: string | null
    readonly members: readonly TaskMonitorWorkflowMemberView[]
  }[]
}

export interface TaskMonitorSubagentView {
  readonly id: string
  readonly label: string
  readonly agentPreset?: string
  readonly mode: 'one-shot' | 'continuable'
  readonly activity: 'running' | 'inactive'
  readonly hasChildren: boolean
}

export interface TaskMonitorFileView {
  readonly path: string
  readonly title: string
  readonly source: 'read' | 'deliverable' | 'artifact'
  readonly kind?: string
  readonly line?: number
  readonly revision?: string
  readonly state?: 'available' | 'updating' | 'missing' | 'failed'
  readonly artifactId?: string
  readonly artifactSourceId?: string
  readonly taskId?: string
  readonly previewKind?: string
}

export interface TaskMonitorArtifactInput {
  readonly id: string
  readonly sourceId: string
  readonly sessionId: string
  readonly path: string
  readonly title: string
  readonly kind: string
  readonly state: 'available' | 'updating' | 'missing' | 'failed'
  readonly updatedAt: number
  readonly revision?: string
  readonly taskId?: string
  readonly previewKind?: string
}

export interface TaskMonitorJobView extends HarnessNativeJobView {
  readonly artifact?: TaskMonitorArtifactInput
}

export interface TaskMonitorMcpView {
  readonly server: string
  readonly status: 'used' | 'available-last-request'
}

export interface TaskMonitorViewModel {
  readonly session: {
    readonly id: string
    readonly title: string
    readonly projectTitle?: string
    readonly agentPreset?: string
    readonly updatedAt?: number
  }
  readonly status: TaskMonitorOverallStatus
  readonly error?: string
  readonly pendingInteraction?: string
  readonly goal: TaskMonitorGoalView | null
  readonly todos: readonly TaskMonitorTodoView[]
  readonly todoProgress: { readonly completed: number; readonly total: number } | null
  readonly todoLists: readonly TaskMonitorTodoListView[]
  readonly plan: TaskMonitorPlanView | null
  readonly workflows: readonly TaskMonitorWorkflowView[]
  readonly subagents: readonly TaskMonitorSubagentView[]
  readonly runningTools: readonly { readonly name: string; readonly callId?: string; readonly startedAt?: number }[]
  readonly jobs: readonly TaskMonitorJobView[]
  readonly inputs: readonly TaskMonitorFileView[]
  readonly outputs: readonly TaskMonitorFileView[]
  readonly skills: readonly string[]
  readonly mcps: readonly TaskMonitorMcpView[]
  readonly model?: { readonly provider: string; readonly model: string }
  readonly queueCount: number
}

export interface TaskMonitorProjectionInput {
  readonly sessionId: string
  readonly sessions: HarnessSessionListSnapshot
  readonly conversation: HarnessConversationSnapshot
  readonly goal: unknown
  readonly todos: unknown
  readonly plan: unknown
  readonly artifacts: readonly TaskMonitorArtifactInput[]
  /** Complete-log resource evidence supplied by the same plugin's read-only Host route. */
  readonly resourceHistory?: TaskMonitorResourceHistoryV1
  readonly projectTitle?: string
  /** Exact native Workspace root, used only to canonicalize relative and absolute output paths. */
  readonly projectPath?: string
}

const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/
const TODO_STATUSES = new Set<TaskMonitorTodoStatus>(['pending', 'in_progress', 'completed'])
const WORKFLOW_STATUSES = new Set<TaskMonitorWorkflowStatus>(['running', 'completed', 'failed', 'cancelled', 'interrupted'])

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function resourceHistory(value: unknown): TaskMonitorResourceHistoryV1 | undefined {
  const input = record(value)
  if (input?.schema !== TASK_MONITOR_RESOURCES_SCHEMA
    || (input.capturedThroughSeq !== null && (!Number.isSafeInteger(input.capturedThroughSeq) || (input.capturedThroughSeq as number) < 0))
    || !Array.isArray(input.skills) || !Array.isArray(input.mcps)
    || (input.todoSnapshots !== undefined && !Array.isArray(input.todoSnapshots))) return undefined
  const skills = input.skills.every(item => typeof item === 'string' && ID.test(item)) ? input.skills as string[] : null
  const mcps = input.mcps.every(item => typeof item === 'string' && ID.test(item)) ? input.mcps as string[] : null
  if (skills === null || mcps === null || new Set(skills).size !== skills.length || new Set(mcps).size !== mcps.length) return undefined
  const todoSnapshots: TaskMonitorTodoSnapshotV1[] = []
  const seenSeq = new Set<number>()
  for (const candidate of input.todoSnapshots ?? []) {
    const snapshot = record(candidate)
    const seq = snapshot?.seq
    const time = snapshot?.time
    const todos = parseTodoItems(snapshot?.todos)
    if (!Number.isSafeInteger(seq) || (seq as number) < 0 || seenSeq.has(seq as number)
      || (time !== undefined && (typeof time !== 'number' || !Number.isFinite(time) || time < 0))
      || todos === undefined) return undefined
    seenSeq.add(seq as number)
    todoSnapshots.push(Object.freeze({
      seq: seq as number,
      ...(time === undefined ? {} : { time }),
      todos,
    }))
  }
  todoSnapshots.sort((left, right) => left.seq - right.seq)
  return Object.freeze({
    schema: TASK_MONITOR_RESOURCES_SCHEMA,
    capturedThroughSeq: input.capturedThroughSeq as number | null,
    skills: Object.freeze([...skills]),
    mcps: Object.freeze([...mcps]),
    todoSnapshots: Object.freeze(todoSnapshots),
  })
}

export function parseTaskMonitorResourceHistory(value: unknown): TaskMonitorResourceHistoryV1 | undefined {
  return resourceHistory(value)
}

function toolCallSuccess(data: Readonly<Record<string, unknown>>): { readonly callId: string; readonly success: boolean } | null {
  const message = record(data.message)
  const source = record(message?.source)
  const callId = source?.kind === 'tool' ? text(source.callId) : undefined
  if (callId === undefined || !Array.isArray(message?.content)) return null
  const result = message.content.find(candidate => record(candidate)?.type === 'tool-result')
  const content = record(result)
  return content === null || typeof content.isError !== 'boolean' ? null : { callId, success: !content.isError }
}

/** Fold only producer-declared Skill invocations and literal native Tool calls from a complete Harness log. */
export function collectTaskMonitorResourceHistory(events: readonly HarnessSessionHistoryEvent[]): TaskMonitorResourceHistoryV1 {
  const explicitSkills: string[] = []
  const skillCalls = new Map<string, string>()
  const successfulCalls = new Set<string>()
  const mcps: string[] = []
  const todoSnapshots = new Map<number, TaskMonitorTodoSnapshotV1>()
  let capturedThroughSeq: number | null = null
  for (const event of events) {
    if (Number.isSafeInteger(event.seq) && (event.seq ?? -1) >= 0) capturedThroughSeq = Math.max(capturedThroughSeq ?? 0, event.seq!)
    const data = record(event.data)
    if (data === null) continue
    if (event.type === 'todo/write' && Number.isSafeInteger(event.seq) && (event.seq ?? -1) >= 0) {
      const todos = parseTodoItems(data.todos)
      if (todos !== undefined) todoSnapshots.set(event.seq!, Object.freeze({
        seq: event.seq!,
        ...(typeof event.time === 'number' && Number.isFinite(event.time) && event.time >= 0 ? { time: event.time } : {}),
        todos,
      }))
      continue
    }
    if (event.type === 'user/message') {
      const source = record(data.source)
      const skill = source?.kind === 'skill-invocation' ? text(source.name) : undefined
      if (skill !== undefined && ID.test(skill) && !explicitSkills.includes(skill)) explicitSkills.push(skill)
      continue
    }
    if (event.type === 'tool/call') {
      const callId = text(data.callId)
      const callName = text(data.name)
      if (callId === undefined || callName === undefined) continue
      if (callName === 'skill') {
        const argsRaw = text(data.arguments)
        const skill = argsRaw === undefined ? undefined : skillNameFromArguments(argsRaw)
        if (skill !== undefined) skillCalls.set(callId, skill)
      } else {
        const match = callName.match(/^mcp__([^_][a-zA-Z0-9_-]*)__[a-zA-Z0-9_-]+$/)
        if (match?.[1] !== undefined && !mcps.includes(match[1])) mcps.push(match[1])
      }
      continue
    }
    if (event.type === 'tool/result') {
      const result = toolCallSuccess(data)
      if (result?.success === true) successfulCalls.add(result.callId)
    }
  }
  const skills = [...explicitSkills]
  for (const [callId, skill] of skillCalls) {
    if (successfulCalls.has(callId) && !skills.includes(skill)) skills.push(skill)
  }
  const recentTodoSnapshots = [...todoSnapshots.values()].sort((left, right) => left.seq - right.seq).slice(-100)
  return Object.freeze({
    schema: TASK_MONITOR_RESOURCES_SCHEMA,
    capturedThroughSeq,
    skills: Object.freeze(skills),
    mcps: Object.freeze(mcps),
    todoSnapshots: Object.freeze(recentTodoSnapshots),
  })
}

function basename(path: string): string {
  const clean = path.replace(/\\/g, '/')
  return clean.slice(clean.lastIndexOf('/') + 1) || path
}

function normalizedPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+/g, '/')
  return normalized.length > 1 ? normalized.replace(/\/$/, '') : normalized
}

function canonicalOutputPath(path: string, projectPath?: string): string {
  const normalized = normalizedPath(path).replace(/^\.\//, '')
  const workspace = projectPath === undefined ? undefined : normalizedPath(projectPath)
  return workspace !== undefined && normalized.startsWith(`${workspace}/`)
    ? normalized.slice(workspace.length + 1)
    : normalized
}

function existingOutputKey(files: ReadonlyMap<string, TaskMonitorFileView>, path: string, projectPath?: string): string {
  const key = canonicalOutputPath(path, projectPath)
  if (files.has(key)) return key
  const suffixMatches = [...files.keys()].filter(existing => (
    (!existing.startsWith('/') && key.endsWith(`/${existing}`))
    || (!key.startsWith('/') && existing.endsWith(`/${key}`))
  ))
  return suffixMatches.length === 1 ? suffixMatches[0]! : key
}

function chatNodes(snapshot: HarnessConversationSnapshot): readonly Readonly<Record<string, unknown>>[] {
  const nodes: Readonly<Record<string, unknown>>[] = []
  try {
    for (const candidate of snapshot.chat?.nodes?.values() ?? []) {
      const entry = record(candidate)
      if (entry !== null) nodes.push(entry)
    }
  } catch { /* A malformed foreign view contributes no monitor facts. */ }
  for (const candidate of snapshot.nodes ?? []) {
    const entry = record(candidate)
    if (entry !== null) nodes.push(entry)
  }
  return nodes
}

function nodePayload(node: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return record(node.data) ?? node
}

function parseGoal(value: unknown): TaskMonitorGoalView | null {
  const projection = record(value)
  const goal = record(projection?.goal)
  if (projection === null || goal === null) return null
  const id = text(goal.id)
  const objective = text(goal.objective)
  const phase = goal.phase
  const roundsStarted = finite(projection.roundsStarted)
  const maxGoalRounds = finite(goal.maxGoalRounds)
  const updatedAt = finite(projection.updatedAt)
  if (id === undefined || objective === undefined || !ID.test(id)
    || (phase !== 'active' && phase !== 'paused' && phase !== 'blocked' && phase !== 'complete')
    || roundsStarted === undefined || !Number.isInteger(roundsStarted) || roundsStarted < 0
    || maxGoalRounds === undefined || !Number.isInteger(maxGoalRounds) || maxGoalRounds <= 0
    || updatedAt === undefined) return null
  const blocked = record(goal.blockedReason)
  const blockedReason = phase === 'blocked' ? text(blocked?.message) : undefined
  return Object.freeze({
    id, objective, phase, roundsStarted, maxGoalRounds, updatedAt,
    ...(blockedReason === undefined ? {} : { blockedReason }),
  })
}

function parseTodoItems(value: unknown): readonly TaskMonitorTodoView[] | undefined {
  if (!Array.isArray(value)) return undefined
  const output: TaskMonitorTodoView[] = []
  const seen = new Set<string>()
  for (const candidate of value) {
    const item = record(candidate)
    const content = text(item?.content)
    const status = item?.status
    if (item === null || content === undefined || seen.has(content)
      || typeof status !== 'string' || !TODO_STATUSES.has(status as TaskMonitorTodoStatus)) return undefined
    seen.add(content)
    output.push(Object.freeze({ content, status: status as TaskMonitorTodoStatus }))
  }
  return Object.freeze(output)
}

function parseTodos(value: unknown): readonly TaskMonitorTodoView[] {
  return parseTodoItems(value) ?? Object.freeze([])
}

function sameTodoList(left: readonly TaskMonitorTodoView[], right: readonly TaskMonitorTodoView[]): boolean {
  if (left.length === 0 || right.length === 0) return false
  const leftItems = new Set(left.map(item => item.content))
  const rightItems = new Set(right.map(item => item.content))
  let intersection = 0
  for (const content of leftItems) if (rightItems.has(content)) intersection += 1
  const union = new Set([...leftItems, ...rightItems]).size
  return union > 0 && intersection / union >= 0.5
}

function todoProgress(items: readonly TaskMonitorTodoView[]): { readonly completed: number; readonly total: number } {
  return Object.freeze({ completed: items.filter(item => item.status === 'completed').length, total: items.length })
}

function projectTodoLists(
  snapshots: readonly TaskMonitorTodoSnapshotV1[],
  currentProjection: readonly TaskMonitorTodoView[] | undefined,
): readonly TaskMonitorTodoListView[] {
  const groups: Array<{
    id: string
    items: readonly TaskMonitorTodoView[]
    revisionCount: number
    firstSeq?: number
    lastSeq?: number
  }> = []
  const ordered = [...snapshots].sort((left, right) => left.seq - right.seq)
  let latestSnapshotWasEmpty = false
  for (const snapshot of ordered) {
    latestSnapshotWasEmpty = snapshot.todos.length === 0
    if (snapshot.todos.length === 0) continue
    const previous = groups.at(-1)
    if (previous !== undefined && sameTodoList(previous.items, snapshot.todos)) {
      previous.items = snapshot.todos
      previous.revisionCount += 1
      previous.lastSeq = snapshot.seq
    } else {
      groups.push({ id: `todo:${snapshot.seq}`, items: snapshot.todos, revisionCount: 1, firstSeq: snapshot.seq, lastSeq: snapshot.seq })
    }
  }
  let hasCurrent = !latestSnapshotWasEmpty && groups.length > 0
  if (currentProjection !== undefined) {
    hasCurrent = currentProjection.length > 0
    if (currentProjection.length > 0) {
      const previous = groups.at(-1)
      if (previous !== undefined && sameTodoList(previous.items, currentProjection)) previous.items = currentProjection
      else groups.push({ id: 'todo:projection', items: currentProjection, revisionCount: 1 })
    }
  }
  return Object.freeze(groups.map((group, index) => Object.freeze({
    id: group.id,
    items: group.items,
    progress: todoProgress(group.items),
    revisionCount: group.revisionCount,
    ...(group.firstSeq === undefined ? {} : { firstSeq: group.firstSeq }),
    ...(group.lastSeq === undefined ? {} : { lastSeq: group.lastSeq }),
    current: hasCurrent && index === groups.length - 1,
  })).reverse())
}

function parsePlan(value: unknown): TaskMonitorPlanView | null {
  const plan = record(value)
  return plan !== null && typeof plan.active === 'boolean' && typeof plan.pending === 'boolean'
    ? Object.freeze({ active: plan.active, pending: plan.pending })
    : null
}

function parseWorkflows(snapshot: HarnessConversationSnapshot): readonly TaskMonitorWorkflowView[] {
  const output: TaskMonitorWorkflowView[] = []
  for (const node of chatNodes(snapshot)) {
    if (node.kind !== 'workflow-run') continue
    const data = nodePayload(node)
    const name = text(data.name)
    const status = data.status
    if (name === undefined || typeof status !== 'string'
      || !WORKFLOW_STATUSES.has(status as TaskMonitorWorkflowStatus) || !Array.isArray(data.phases)) continue
    const phases: TaskMonitorWorkflowView['phases'][number][] = []
    let valid = true
    for (const candidate of data.phases) {
      const phase = record(candidate)
      const key = text(phase?.key)
      const phaseName = phase?.phase === null ? null : text(phase?.phase)
      if (phase === null || key === undefined || (phase.phase !== null && phaseName === undefined) || !Array.isArray(phase.members)) { valid = false; break }
      const members: TaskMonitorWorkflowMemberView[] = []
      for (const memberValue of phase.members) {
        const member = record(memberValue)
        const label = text(member?.label)
        const childId = text(member?.childId)
        const memberStatus = member?.status
        if (member === null || label === undefined || childId === undefined || !ID.test(childId)
          || typeof memberStatus !== 'string' || !WORKFLOW_STATUSES.has(memberStatus as TaskMonitorWorkflowStatus)) { valid = false; break }
        members.push(Object.freeze({ label, childId, status: memberStatus as TaskMonitorWorkflowStatus }))
      }
      if (!valid) break
      phases.push(Object.freeze({ key, phase: phaseName as string | null, members: Object.freeze(members) }))
    }
    if (valid) output.push(Object.freeze({ name, status: status as TaskMonitorWorkflowStatus, phases: Object.freeze(phases) }))
  }
  return Object.freeze(output)
}

function parseSubagents(sessions: HarnessSessionListSnapshot, sessionId: string): readonly TaskMonitorSubagentView[] {
  const entries = sessions.subagentsByParent?.[sessionId]?.entries
  if (!Array.isArray(entries)) return Object.freeze([])
  return Object.freeze(entries.flatMap(entry => {
    if (entry.kind !== 'child' || !ID.test(entry.id)) return []
    const agentPreset = text(sessions.byId[entry.id]?.agentPreset)
    return [Object.freeze({
      id: entry.id,
      label: text(entry.label) ?? entry.id,
      ...(agentPreset === undefined ? {} : { agentPreset }),
      mode: entry.mode,
      activity: entry.activity,
      hasChildren: entry.hasChildren,
    })]
  }))
}

function isSettledTool(block: HarnessToolCallBlock): block is Extract<HarnessToolCallBlock, { readonly kind: 'tool-result' }> {
  return record(block)?.kind === 'tool-result'
}

function toolName(block: HarnessToolCallBlock): string | undefined {
  return isSettledTool(block) ? text(block.call?.name) : text(block.name)
}

function toolChildren(block: HarnessToolCallBlock): readonly HarnessToolCallBlock[] {
  return Array.isArray(block.subCalls) ? block.subCalls : []
}

function collectToolBlocks(snapshot: HarnessConversationSnapshot): readonly HarnessToolCallBlock[] {
  const roots: HarnessToolCallBlock[] = [...snapshot.runningCalls]
  for (const node of chatNodes(snapshot)) {
    if (node.kind === 'tool-call') {
      const root = record(nodePayload(node).root)
      if (root !== null) roots.push(root as unknown as HarnessToolCallBlock)
    } else if (node.kind === 'tool-result') roots.push(nodePayload(node) as unknown as HarnessToolCallBlock)
  }
  const output: HarnessToolCallBlock[] = []
  const seen = new Set<string>()
  const visit = (block: HarnessToolCallBlock, depth: number): void => {
    if (depth > 256) return
    const id = text(record(block)?.callId)
    if (id !== undefined && seen.has(id)) return
    if (id !== undefined) seen.add(id)
    output.push(block)
    for (const child of toolChildren(block)) visit(child, depth + 1)
  }
  for (const root of roots) visit(root, 0)
  return Object.freeze(output)
}

function collectInputFiles(blocks: readonly HarnessToolCallBlock[]): readonly TaskMonitorFileView[] {
  const files = new Map<string, TaskMonitorFileView>()
  for (const block of blocks) {
    const view: HarnessToolCallView | null | undefined = block.callView
    if (view?.card !== 'generic' || view.kind !== 'read' || !Array.isArray(view.locations)) continue
    for (const location of view.locations) {
      const path = text(location.path)
      if (path === undefined) continue
      const key = normalizedPath(path)
      if (files.has(key)) continue
      files.set(key, Object.freeze({
        path, title: basename(path), source: 'read',
        ...(Number.isInteger(location.line) && (location.line ?? 0) > 0 ? { line: location.line } : {}),
      }))
    }
  }
  return Object.freeze([...files.values()])
}

function collectDeliverables(snapshot: HarnessConversationSnapshot): readonly TaskMonitorFileView[] {
  const files = new Map<string, TaskMonitorFileView>()
  const timeline = snapshot.chat?.timeline
  if (timeline === undefined) return Object.freeze([])
  for (const turn of timeline.turnOrder) {
    const value = record(timeline.turns.get(turn)?.data.get('deliverables'))
    if (!Array.isArray(value?.produced)) continue
    for (const candidate of value.produced) {
      const produced = record(candidate)
      const path = text(produced?.path)
      const seq = finite(produced?.seq)
      if (path === undefined || seq === undefined) continue
      files.set(normalizedPath(path), Object.freeze({ path, title: basename(path), source: 'deliverable', revision: String(seq) }))
    }
  }
  return Object.freeze([...files.values()])
}

function collectOutputs(snapshot: HarnessConversationSnapshot, artifacts: readonly TaskMonitorArtifactInput[], sessionId: string, projectPath?: string): readonly TaskMonitorFileView[] {
  const files = new Map(collectDeliverables(snapshot).map(file => [canonicalOutputPath(file.path, projectPath), file]))
  for (const artifact of artifacts) {
    if (artifact.sessionId !== sessionId) continue
    files.set(existingOutputKey(files, artifact.path, projectPath), Object.freeze({
      path: artifact.path, title: artifact.title, source: 'artifact', kind: artifact.kind, state: artifact.state,
      artifactId: artifact.id, artifactSourceId: artifact.sourceId,
      ...(artifact.revision === undefined ? {} : { revision: artifact.revision }),
      ...(artifact.taskId === undefined ? {} : { taskId: artifact.taskId }),
      ...(artifact.previewKind === undefined ? {} : { previewKind: artifact.previewKind }),
    }))
  }
  return Object.freeze([...files.values()])
}

function skillNameFromArguments(value: string): string | undefined {
  try {
    const args = record(JSON.parse(value))
    const name = text(args?.name)
    return name !== undefined && ID.test(name) ? name : undefined
  } catch { return undefined }
}

function collectSkills(snapshot: HarnessConversationSnapshot, blocks: readonly HarnessToolCallBlock[], history?: TaskMonitorResourceHistoryV1): readonly string[] {
  const output: string[] = [...(history?.skills ?? [])]
  for (const node of chatNodes(snapshot)) {
    if (node.kind !== 'context') continue
    const source = record(nodePayload(node).source)
    const skill = source?.kind === 'skill-invocation' ? text(source.name) : undefined
    if (skill !== undefined && !output.includes(skill)) output.push(skill)
  }
  for (const block of blocks) {
    if (!isSettledTool(block) || block.isError || block.call?.name !== 'skill') continue
    const skill = skillNameFromArguments(block.call.argsRaw)
    if (skill !== undefined && !output.includes(skill)) output.push(skill)
  }
  return Object.freeze(output)
}

function trajectory(snapshot: HarnessConversationSnapshot): Readonly<Record<string, unknown>> | null {
  try { return record(snapshot.views?.get('trajectory')) } catch { return null }
}

function latestPrompt(snapshot: HarnessConversationSnapshot): Readonly<Record<string, unknown>> | null {
  const requests = trajectory(snapshot)?.requests
  if (!Array.isArray(requests)) return null
  for (let index = requests.length - 1; index >= 0; index--) {
    const prompt = record(record(requests[index])?.prompt)
    if (prompt !== null) return prompt
  }
  return null
}

function collectModel(snapshot: HarnessConversationSnapshot): TaskMonitorViewModel['model'] {
  const config = record(latestPrompt(snapshot)?.config)
  const provider = text(config?.provider)
  const model = text(config?.model)
  return provider !== undefined && model !== undefined ? Object.freeze({ provider, model }) : undefined
}

function collectMcps(snapshot: HarnessConversationSnapshot, blocks: readonly HarnessToolCallBlock[], history?: TaskMonitorResourceHistoryV1): readonly TaskMonitorMcpView[] {
  const used = new Set<string>(history?.mcps ?? [])
  for (const block of blocks) {
    const match = toolName(block)?.match(/^mcp__([^_][a-zA-Z0-9_-]*)__[a-zA-Z0-9_-]+$/)
    if (match?.[1] !== undefined) used.add(match[1])
  }
  const available = new Set<string>()
  const tools = latestPrompt(snapshot)?.tools
  if (Array.isArray(tools)) {
    for (const candidate of tools) {
      const match = text(record(candidate)?.name)?.match(/^mcp__([^_][a-zA-Z0-9_-]*)__[a-zA-Z0-9_-]+$/)
      if (match?.[1] !== undefined && !used.has(match[1])) available.add(match[1])
    }
  }
  return Object.freeze([
    ...[...used].map(server => Object.freeze({ server, status: 'used' as const })),
    ...[...available].map(server => Object.freeze({ server, status: 'available-last-request' as const })),
  ])
}

export function isLivePaimindJob(job: HarnessNativeJobView): boolean {
  return job.status === 'running' || job.status === 'stopping'
}

/** Exact producer kind only; labels, commands and model prose never classify a task. */
export function isPaimindArtifactJob(job: HarnessNativeJobView): boolean {
  return job.kind === PAIMIND_ARTIFACT_JOB_KIND
}

export function artifactsFromProjection(value: unknown): readonly Readonly<ArtifactProducedEnvelopeV1>[] {
  try { return defineArtifactProjection(value as PaimindArtifactProjectionV1).artifacts } catch { return Object.freeze([]) }
}

/** Legacy exact-producer projection retained for existing consumers. */
export function projectPaimindArtifactJobs(jobs: readonly HarnessNativeJobView[], artifacts: readonly Readonly<ArtifactProducedEnvelopeV1>[]): readonly PaimindArtifactJobView[] {
  const artifactByTask = new Map(artifacts.map(artifact => [artifact.taskId, artifact]))
  return Object.freeze(orderJobs(jobs.filter(isPaimindArtifactJob)).map(job => {
    const artifact = artifactByTask.get(job.id)
    return Object.freeze({ ...job, ...(artifact === undefined ? {} : { artifact }) })
  }))
}

export function orderJobs<T extends HarnessNativeJobView>(jobs: readonly T[]): readonly T[] {
  return Object.freeze([...jobs].sort((left, right) => {
    const live = Number(isLivePaimindJob(right)) - Number(isLivePaimindJob(left))
    if (live !== 0) return live
    if (isLivePaimindJob(left)) return left.startedAt - right.startedAt
    const finished = (right.finishedAt ?? right.startedAt) - (left.finishedAt ?? left.startedAt)
    return finished !== 0 ? finished : left.startedAt - right.startedAt
  }))
}

/** All native Jobs remain visible; exact Artifact task ids only enrich their rows. */
export function projectTaskMonitorJobs(jobs: readonly HarnessNativeJobView[], artifacts: readonly TaskMonitorArtifactInput[]): readonly TaskMonitorJobView[] {
  const byTask = new Map(artifacts.flatMap(artifact => artifact.taskId === undefined ? [] : [[artifact.taskId, artifact] as const]))
  return Object.freeze(orderJobs(jobs).map(job => {
    const artifact = byTask.get(job.id)
    return Object.freeze({ ...job, ...(artifact === undefined ? {} : { artifact }) })
  }))
}

/** Build the complete monitor from exact native facts; malformed optional sources fail closed. */
export function projectTaskMonitor(input: TaskMonitorProjectionInput): TaskMonitorViewModel {
  const session = input.sessions.byId[input.sessionId]
  const goal = parseGoal(input.goal)
  const currentTodos = parseTodoItems(input.todos)
  const todoLists = projectTodoLists(input.resourceHistory?.todoSnapshots ?? [], currentTodos)
  const todos = currentTodos ?? todoLists.find(list => list.current)?.items ?? Object.freeze([])
  const plan = parsePlan(input.plan)
  const workflows = parseWorkflows(input.conversation)
  const blocks = collectToolBlocks(input.conversation)
  const runningTools = Object.freeze(blocks.flatMap(block => {
    if (isSettledTool(block)) return []
    const callId = text(block.callId)
    const startedAt = finite(block.time)
    return [{
      name: text(block.name) ?? 'unknown',
      ...(callId === undefined ? {} : { callId }),
      ...(startedAt === undefined ? {} : { startedAt }),
    }]
  }))
  const jobs = projectTaskMonitorJobs(input.sessions.jobsBySession?.[input.sessionId] ?? [], input.artifacts)
  const error = text(input.conversation.lastAgentError)
  const pendingInteraction = text(session?.pendingInteraction)
    ?? (input.conversation.pending.length > 0 ? input.conversation.pending[0]?.kind : undefined)
  const status: TaskMonitorOverallStatus = error !== undefined || goal?.phase === 'blocked'
    ? 'blocked'
    : pendingInteraction !== undefined
      ? 'waiting'
      : session?.running === true || input.conversation.running || runningTools.length > 0
        || jobs.some(isLivePaimindJob) || workflows.some(workflow => workflow.status === 'running')
        ? 'running'
        : goal?.phase === 'paused'
          ? 'paused'
          : goal?.phase === 'complete'
            ? 'complete'
            : 'idle'
  const completed = todos.filter(todo => todo.status === 'completed').length
  const model = collectModel(input.conversation)
  const projectTitle = text(input.projectTitle)
  const agentPreset = text(session?.agentPreset)
  const updatedAt = finite(session?.updatedAt)
  return Object.freeze({
    session: Object.freeze({
      id: input.sessionId,
      title: text(session?.displayTitle) ?? text(session?.title) ?? input.sessionId,
      ...(projectTitle === undefined ? {} : { projectTitle }),
      ...(agentPreset === undefined ? {} : { agentPreset }),
      ...(updatedAt === undefined ? {} : { updatedAt }),
    }),
    status,
    ...(error === undefined ? {} : { error }),
    ...(pendingInteraction === undefined ? {} : { pendingInteraction }),
    goal,
    todos,
    todoProgress: todos.length === 0 ? null : Object.freeze({ completed, total: todos.length }),
    todoLists,
    plan,
    workflows,
    subagents: parseSubagents(input.sessions, input.sessionId),
    runningTools,
    jobs,
    inputs: collectInputFiles(blocks),
    outputs: collectOutputs(input.conversation, input.artifacts, input.sessionId, text(session?.cwd) ?? text(input.projectPath)),
    skills: collectSkills(input.conversation, blocks, input.resourceHistory),
    mcps: collectMcps(input.conversation, blocks, input.resourceHistory),
    ...(model === undefined ? {} : { model }),
    queueCount: Array.isArray(input.conversation.queue) ? input.conversation.queue.length : 0,
  })
}
