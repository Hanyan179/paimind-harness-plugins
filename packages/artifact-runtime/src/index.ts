import { createHash } from 'node:crypto'
import { isAbsolute, relative, resolve } from 'node:path'
import {
  artifactProducedFromToolMeta,
  artifactTraceFromToolMeta,
  defineArtifactProducedEnvelope,
  defineArtifactProjection,
  defineArtifactTraceEnvelope,
  PAIMIND_ARTIFACT_JOB_KIND,
  type ArtifactProducedEnvelopeV1,
  type ArtifactTraceDocumentRefV2,
  type ArtifactTraceEnvelope,
  type PaimindArtifactEventKind,
  type PaimindArtifactPreviewChannel,
  type PaimindArtifactProjectionV1,
  type PaimindArtifactToolMetaV1,
} from '@hansen/contracts'
import type {
  PaimindArtifactRuntimeHostContext,
  PaimindHostAgent,
  PaimindSessionEvent,
  PaimindToolExecutionResult,
  PaimindToolRunContext,
} from '@hansen/harness-compat/host'

export const name = 'paimind-artifact-runtime'
export const inject = ['jobs', 'tools', 'fs', 'workspaceRegistry', 'sessionProjections']
export const ARTIFACT_PROJECTION_KEY = 'paimind.artifacts'
export { PAIMIND_ARTIFACT_JOB_KIND }

export interface PaimindGeneratorRequestDescriptor {
  readonly path: string
  readonly title: string
}

export interface PaimindGeneratorOutput {
  readonly path: string
  readonly title: string
  readonly traceDocument?: unknown
  readonly traceDocumentRef?: ArtifactTraceDocumentRefV2
}

export interface PaimindGeneratedArtifactResult {
  readonly artifact: Readonly<ArtifactProducedEnvelopeV1>
  readonly trace?: Readonly<ArtifactTraceEnvelope>
}

export interface PaimindGeneratorExecutionContext {
  readonly signal: AbortSignal
  /** Publish text through the native Harness `write` Tool and its sandbox/approval policies. */
  writeText(path: string, content: string): Promise<string>
  /** Run a trusted provider command through the native Harness `bash` Tool and its sandbox policy. */
  runWorkspaceCommand(input: {
    readonly command: string
    readonly description: string
    readonly timeoutMs?: number
  }): Promise<{ readonly stdout: string }>
}

/** Capability only: providers do not own Job, Session, Workspace or Artifact lifecycle state. */
export interface PaimindGeneratorProvider {
  readonly id: string
  readonly kind: PaimindArtifactEventKind
  readonly previewKind: PaimindArtifactPreviewChannel
  describe(input: Readonly<Record<string, unknown>>): PaimindGeneratorRequestDescriptor
  generate(
    input: Readonly<Record<string, unknown>>,
    context: PaimindGeneratorExecutionContext,
  ): Promise<PaimindGeneratorOutput>
}

export interface PaimindArtifactGeneratorService {
  register(provider: PaimindGeneratorProvider): () => void
  list(): readonly PaimindGeneratorProvider[]
  execute(
    providerId: string,
    input: Readonly<Record<string, unknown>>,
    exec: PaimindToolRunContext,
  ): Promise<Readonly<PaimindGeneratedArtifactResult>>
}

export interface PaimindCurrentSessionArtifactRequirement {
  readonly description: string
  readonly kind?: PaimindArtifactEventKind
  readonly producerIds?: readonly string[]
  readonly excludedProducerIds?: readonly string[]
  readonly pathSuffix?: string
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string`)
  return value.trim()
}

/** Resolve a persisted Artifact path to one safe Workspace-relative path for native tools. */
export function artifactWorkspaceRelativePath(
  value: unknown,
  exec: PaimindToolRunContext,
  options: { readonly label: string; readonly pathSuffix?: string },
): string {
  const path = requiredText(value, options.label)
  const cwd = exec.agent?.session.header.cwd
  const candidate = isAbsolute(path)
    ? (() => {
        if (cwd === undefined) throw new Error(`${options.label} cannot be resolved without a Workspace root`)
        return relative(resolve(cwd), path)
      })()
    : path
  if (candidate === '' || isAbsolute(candidate) || candidate.split(/[\\/]+/).includes('..')) {
    throw new Error(`${options.label} escapes the Workspace`)
  }
  if (options.pathSuffix !== undefined && !candidate.toLowerCase().endsWith(options.pathSuffix.toLowerCase())) {
    throw new Error(`${options.label} must be a Workspace-relative ${options.pathSuffix} path`)
  }
  return candidate
}

/** Enforce the common Artifact identity, Session, producer, kind and suffix boundary. */
export function requireCurrentSessionArtifact(
  projectionValue: unknown,
  exec: PaimindToolRunContext,
  artifactId: string,
  requirement: PaimindCurrentSessionArtifactRequirement,
): Readonly<ArtifactProducedEnvelopeV1> {
  const agent = exec.agent
  if (agent === undefined) throw new Error(`${requirement.description} requires a live Harness Agent`)
  const artifact = defineArtifactProjection(projectionValue as PaimindArtifactProjectionV1).artifacts
    .find(candidate => candidate.artifactId === artifactId)
  const allowedProducer = requirement.producerIds === undefined || requirement.producerIds.includes(artifact?.producerId ?? '')
  const excludedProducer = requirement.excludedProducerIds?.includes(artifact?.producerId ?? '') ?? false
  const validSuffix = requirement.pathSuffix === undefined
    || (artifact?.path.toLowerCase().endsWith(requirement.pathSuffix.toLowerCase()) ?? false)
  if (artifact === undefined
    || artifact.state !== 'available'
    || artifact.sessionId !== agent.id
    || (requirement.kind !== undefined && artifact.kind !== requirement.kind)
    || !allowedProducer
    || excludedProducer
    || !validSuffix) {
    throw new Error(`Artifact ${artifactId} is not ${requirement.description}`)
  }
  return artifact
}

interface ProjectionState {
  readonly artifacts: readonly Readonly<ArtifactProducedEnvelopeV1>[]
  readonly traces: readonly Readonly<ArtifactTraceEnvelope>[]
}

const EMPTY_STATE: ProjectionState = Object.freeze({ artifacts: Object.freeze([]), traces: Object.freeze([]) })

const artifactProjectionStateSchema = {
  parse(value: unknown): ProjectionState {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('invalid PAIMind artifact projection state')
    }
    const candidate = value as Partial<ProjectionState>
    if (!Array.isArray(candidate.artifacts) || !Array.isArray(candidate.traces)) {
      throw new Error('invalid PAIMind artifact projection state')
    }
    const projection = defineArtifactProjection({
      schema: 'paimind.artifacts/v1',
      artifacts: candidate.artifacts,
      traces: candidate.traces,
    })
    return Object.freeze({ artifacts: projection.artifacts, traces: projection.traces })
  },
}

const artifactProjectionViewSchema = {
  parse(value: unknown): Readonly<PaimindArtifactProjectionV1> {
    return defineArtifactProjection(value as PaimindArtifactProjectionV1)
  },
}

function eventMeta(event: PaimindSessionEvent): unknown {
  if (event.type !== 'tool/result' || typeof event.data !== 'object' || event.data === null) return undefined
  return (event.data as { readonly meta?: unknown }).meta
}

/** Pure durable fold: latest higher revision wins for each explicit artifact id. */
export const artifactProjectionDefinition = {
  key: ARTIFACT_PROJECTION_KEY,
  stateSchema: artifactProjectionStateSchema,
  init(): ProjectionState { return EMPTY_STATE },
  apply(state: ProjectionState, event: PaimindSessionEvent): ProjectionState {
    const meta = eventMeta(event)
    const artifact = artifactProducedFromToolMeta(meta)
    const candidateTrace = artifactTraceFromToolMeta(meta)
    const trace = artifact !== null && candidateTrace !== null
      && candidateTrace.artifactId === artifact.artifactId
      && candidateTrace.sessionId === artifact.sessionId
      && candidateTrace.workspaceId === artifact.workspaceId
      && candidateTrace.taskId === artifact.taskId
      && candidateTrace.artifactRevision === artifact.revision
      && artifact.traceId === candidateTrace.traceId
      ? candidateTrace
      : null
    if (artifact === null && trace === null) return state
    const currentArtifact = artifact === null ? undefined : state.artifacts.find(entry => entry.artifactId === artifact.artifactId)
    const currentTrace = trace === null ? undefined : state.traces.find(entry => entry.traceId === trace.traceId)
    const artifactChanged = artifact !== null && (currentArtifact === undefined || currentArtifact.revision < artifact.revision)
    const traceChanged = trace !== null && (currentTrace === undefined || currentTrace.artifactRevision < trace.artifactRevision)
    if (!artifactChanged && !traceChanged) return state
    return Object.freeze({
      artifacts: artifactChanged && artifact !== null
        ? Object.freeze([...state.artifacts.filter(entry => entry.artifactId !== artifact.artifactId), artifact]
            .sort((left, right) => right.producedAt - left.producedAt || left.artifactId.localeCompare(right.artifactId)))
        : state.artifacts,
      traces: traceChanged && trace !== null
        ? Object.freeze([...state.traces.filter(entry => entry.traceId !== trace.traceId), trace]
            .sort((left, right) => right.producedAt - left.producedAt || left.traceId.localeCompare(right.traceId)))
        : state.traces,
    })
  },
  wire: {
    viewSchema: artifactProjectionViewSchema,
    view(state: ProjectionState): Readonly<PaimindArtifactProjectionV1> {
      return defineArtifactProjection({ schema: 'paimind.artifacts/v1', artifacts: state.artifacts, traces: state.traces })
    },
  },
  stateVersion: 1,
} as const

function safeId(input: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(input)
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error
    && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message
  }
  return String(error)
}

function errorCode(error: unknown, signal: AbortSignal): string {
  if (signal.aborted) return 'cancelled'
  if (typeof error === 'object' && error !== null && 'code' in error
    && typeof (error as { code?: unknown }).code === 'string') {
    const code = (error as { code: string }).code.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_')
    if (code !== '') return code
  }
  return 'generation_failed'
}

function textOfToolFailure(content: readonly { readonly type: string; readonly [key: string]: unknown }[]): string {
  const text = content
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
    .join('\n')
  return text === '' ? 'native write tool failed' : text
}

function workspaceCommandResult(value: unknown): { readonly stdout: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('native generator command returned an invalid result')
  }
  const result = value as {
    readonly kind?: unknown
    readonly exitCode?: unknown
    readonly stdout?: { readonly text?: unknown }
    readonly stderr?: { readonly text?: unknown }
  }
  const stdout = typeof result.stdout?.text === 'string' ? result.stdout.text : ''
  const stderr = typeof result.stderr?.text === 'string' ? result.stderr.text : ''
  if (result.kind !== 'foreground' || result.exitCode !== 0) {
    throw new Error(stderr.trim() || stdout.trim() || `native generator command failed with exit code ${String(result.exitCode)}`)
  }
  return Object.freeze({ stdout })
}

function artifactIdFor(providerId: string, sessionId: string, path: string): string {
  return `artifact:${createHash('sha256').update(`${providerId}\0${sessionId}\0${path}`).digest('hex').slice(0, 24)}`
}

function traceIdFor(artifactId: string): string {
  return `trace:${createHash('sha256').update(artifactId).digest('hex').slice(0, 24)}`
}

/** One capability registry plus the shared Native Job/tool-result execution wrapper. */
export class ArtifactGeneratorRegistry implements PaimindArtifactGeneratorService {
  private readonly providers = new Map<string, PaimindGeneratorProvider[]>()

  constructor(private readonly ctx: PaimindArtifactRuntimeHostContext) {}

  register(provider: PaimindGeneratorProvider): () => void {
    if (!safeId(provider.id)) throw new Error(`invalid generator provider id "${provider.id}"`)
    const stack = this.providers.get(provider.id) ?? []
    stack.push(provider)
    this.providers.set(provider.id, stack)
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      const current = this.providers.get(provider.id)
      if (current === undefined) return
      const index = current.lastIndexOf(provider)
      if (index >= 0) current.splice(index, 1)
      if (current.length === 0) this.providers.delete(provider.id)
    }
  }

  list(): readonly PaimindGeneratorProvider[] {
    return Object.freeze([...this.providers.values()].flatMap(stack => stack.at(-1) ?? []))
  }

  async execute(
    providerId: string,
    input: Readonly<Record<string, unknown>>,
    exec: PaimindToolRunContext,
  ): Promise<Readonly<PaimindGeneratedArtifactResult>> {
    const provider = this.providers.get(providerId)?.at(-1)
    if (provider === undefined) throw new Error(`generator provider "${providerId}" is unavailable`)
    const owner = exec.agent
    if (owner === undefined) throw new Error('artifact generation requires a live Harness Agent')
    const cwd = owner.session.header.cwd
    if (cwd === undefined) throw new Error('artifact generation requires a Session Workspace')
    const workspace = this.ctx.workspaceRegistry.list().find(entry => entry.sessionIds.includes(owner.id))
    if (workspace === undefined) throw new Error(`Session "${owner.id}" is not attached to a Harness Workspace`)
    const descriptor = provider.describe(input)
    if (descriptor.path.trim() === '' || descriptor.title.trim() === '') {
      throw new Error(`generator provider "${provider.id}" returned an invalid request descriptor`)
    }

    const controller = new AbortController()
    let settleResult!: (value: Readonly<PaimindGeneratedArtifactResult>) => void
    const result = new Promise<Readonly<PaimindGeneratedArtifactResult>>(resolve => { settleResult = resolve })
    const done = result.then(generated => ({
      status: controller.signal.aborted ? 'killed' as const
        : generated.artifact.state === 'available' ? 'completed' as const : 'failed' as const,
      detail: generated.artifact.state === 'available'
        ? `${generated.artifact.kind} revision ${generated.artifact.revision}`
        : generated.artifact.error?.code ?? 'generation_failed',
    }))
    const taskId = this.ctx.jobs.start({
      kind: PAIMIND_ARTIFACT_JOB_KIND,
      label: descriptor.title,
      owner,
      run: () => ({
        cancel: () => { controller.abort() },
        done,
      }),
    })

    const cancel = (): void => {
      try { this.ctx.jobs.kill(taskId, owner, 'generator tool cancelled') } catch { controller.abort() }
    }
    exec.signal.addEventListener('abort', cancel, { once: true })
    if (exec.signal.aborted) cancel()

    void this.perform(provider, input, descriptor, owner, workspace.id, taskId, exec, controller.signal)
      .then(settleResult)
    try {
      return await result
    } finally {
      exec.signal.removeEventListener('abort', cancel)
    }
  }

  private async perform(
    provider: PaimindGeneratorProvider,
    input: Readonly<Record<string, unknown>>,
    descriptor: PaimindGeneratorRequestDescriptor,
    owner: PaimindHostAgent,
    workspaceId: string,
    taskId: string,
    exec: PaimindToolRunContext,
    signal: AbortSignal,
  ): Promise<Readonly<PaimindGeneratedArtifactResult>> {
    const current = this.ctx.sessionProjections.snapshot(owner.session).values[ARTIFACT_PROJECTION_KEY]
    const prior = (() => {
      try { return defineArtifactProjection(current as PaimindArtifactProjectionV1).artifacts } catch { return [] }
    })()
    const tentativeId = artifactIdFor(provider.id, owner.id, descriptor.path)
    const previous = prior.find(entry => entry.artifactId === tentativeId)
    const revision = (previous?.revision ?? 0) + 1
    let canonicalPath = descriptor.path
    try {
      const output = await provider.generate(input, {
        signal,
        writeText: async (path, content) => {
          if (signal.aborted) throw new Error('artifact generation cancelled')
          const nested = await this.ctx.tools.execute({
            callId: `${exec.callId}:paimind-write`,
            rootCallId: exec.rootCallId,
            name: 'write',
            arguments: { file_path: path, content },
            agent: owner,
            parent: exec.token,
            signal,
          })
          if (nested.isError) throw new Error(textOfToolFailure(nested.content))
          return path
        },
        runWorkspaceCommand: async ({ command, description, timeoutMs }) => {
          if (signal.aborted) throw new Error('artifact generation cancelled')
          const nested = await this.ctx.tools.execute({
            callId: `${exec.callId}:paimind-command`,
            rootCallId: exec.rootCallId,
            name: 'bash',
            arguments: {
              command,
              description,
              workdir: owner.session.header.cwd,
              ...(timeoutMs === undefined ? {} : { timeoutMs }),
            },
            agent: owner,
            parent: exec.token,
            signal,
          })
          if (nested.isError) throw new Error(textOfToolFailure(nested.content))
          return workspaceCommandResult(nested.value)
        },
      })
      const workspacePath = this.workspacePath(workspaceId)
      const root = await this.ctx.fs.resolve(workspacePath, { signal })
      const target = await this.ctx.fs.resolve(output.path, { cwd: workspacePath, signal })
      if (!this.ctx.fs.contains(root, target)) throw new Error('generated artifact is outside its Harness Workspace')
      const info = await this.ctx.fs.stat(target, signal)
      if (info?.type !== 'file') throw new Error('generator completed without publishing a regular file')
      canonicalPath = target.displayPath
      const artifactId = artifactIdFor(provider.id, owner.id, canonicalPath)
      const canonicalPrevious = prior.find(entry => entry.artifactId === artifactId)
      const producedAt = Date.now()
      if (output.traceDocument !== undefined && output.traceDocumentRef !== undefined) {
        throw new Error('generator output cannot inline and reference the same trace')
      }
      const traceId = output.traceDocument === undefined && output.traceDocumentRef === undefined ? undefined : traceIdFor(artifactId)
      const artifact = defineArtifactProducedEnvelope({
        schema: 'paimind.artifact-produced/v1',
        artifactId,
        sessionId: owner.id,
        workspaceId,
        path: canonicalPath,
        title: output.title,
        kind: provider.kind,
        previewKind: provider.previewKind,
        revision: (canonicalPrevious?.revision ?? 0) + 1,
        producerId: provider.id,
        taskId,
        ...(traceId === undefined ? {} : { traceId }),
        state: 'available',
        producedAt,
      })
      const trace = traceId === undefined ? undefined : defineArtifactTraceEnvelope(output.traceDocumentRef === undefined ? {
        schema: 'paimind.artifact-trace/v1', traceId, artifactId, sessionId: owner.id, workspaceId,
        producerId: provider.id, taskId, artifactRevision: artifact.revision, producedAt,
        document: output.traceDocument,
      } : {
        schema: 'paimind.artifact-trace/v2', traceId, artifactId, sessionId: owner.id, workspaceId,
        producerId: provider.id, taskId, artifactRevision: artifact.revision, producedAt,
        documentRef: output.traceDocumentRef,
      })
      return Object.freeze({ artifact, ...(trace === undefined ? {} : { trace }) })
    } catch (error) {
      const artifact = defineArtifactProducedEnvelope({
        schema: 'paimind.artifact-produced/v1',
        artifactId: tentativeId,
        sessionId: owner.id,
        workspaceId,
        path: canonicalPath,
        title: descriptor.title,
        kind: provider.kind,
        previewKind: provider.previewKind,
        revision,
        producerId: provider.id,
        taskId,
        state: 'failed',
        producedAt: Date.now(),
        error: { code: errorCode(error, signal), message: errorMessage(error) },
      })
      return Object.freeze({ artifact })
    }
  }

  private workspacePath(workspaceId: string): string {
    const workspace = this.ctx.workspaceRegistry.list().find(entry => entry.id === workspaceId)
    if (workspace === undefined) throw new Error(`Harness Workspace "${workspaceId}" is unavailable`)
    return workspace.path
  }
}

/** Tool definition helper: the exact envelope becomes the durable presentation metadata. */
export function artifactToolMeta(
  artifact: Readonly<ArtifactProducedEnvelopeV1>,
  trace?: Readonly<ArtifactTraceEnvelope>,
): Readonly<PaimindArtifactToolMetaV1> {
  return Object.freeze({ schema: 'paimind.tool-result/v1', artifact, ...(trace === undefined ? {} : { trace }) })
}

/** Native generic result intent; only successful artifacts expose a Deliverable location. */
export function presentArtifactToolResult(result: {
  readonly isError: boolean
  readonly meta?: unknown
}): Readonly<Record<string, unknown>> | undefined {
  const artifact = artifactProducedFromToolMeta(result.meta)
  if (artifact === null) return undefined
  if (artifact.state !== 'available') {
    return {
      card: 'generic',
      title: artifact.title,
      kind: 'edit',
      content: [{ type: 'text', text: artifact.error?.message ?? 'Artifact generation failed' }],
    }
  }
  return {
    card: 'generic',
    title: artifact.title,
    kind: 'edit',
    locations: [{ path: artifact.path }],
  }
}

/**
 * Keep a failed envelope durable while making the native Tool result fail.
 * Harness Deliverables ignore `isError` calls, so a call-intent location can
 * safely exist without producing a false clickable file on generator failure.
 */
export function normalizeArtifactFailureResult(
  result: PaimindToolExecutionResult,
): PaimindToolExecutionResult {
  if (result.isError) return result
  const artifact = artifactProducedFromToolMeta(result.meta)
  if (artifact?.state !== 'failed') return result
  return Object.freeze({
    isError: true as const,
    content: result.content,
    error: { message: artifact.error?.message ?? 'Artifact generation failed' },
    meta: result.meta,
  })
}

export function apply(ctx: PaimindArtifactRuntimeHostContext): void {
  ctx.sessionProjections.register(artifactProjectionDefinition)
  ctx.on('tools/execute', async (_exec, next) => normalizeArtifactFailureResult(await next()))
  const registry = new ArtifactGeneratorRegistry(ctx)
  ctx.effect(() => {
    const dispose = ctx.reflect.provide('paimindArtifactGenerators', registry)
    return () => { void dispose() }
  }, 'paimind-artifact-runtime: generator service')
}
