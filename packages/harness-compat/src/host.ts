import { defineTool } from '@deepseek-ai/dsh-tools'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import Schema from '@deepseek-ai/schemastery'
import { Service, type Context } from '@deepseek-ai/cordis'
import {
  Remote,
  TypertRemoteService,
} from '@deepseek-ai/dsh-typert-protocol'
import {
  defineDomain,
  domainTable,
} from '@deepseek-ai/dsh-storage-domain'
import {
  foldScheduleEvents,
  scheduleView,
} from '@deepseek-ai/dsh-schedule'
import { resolveHarnessSettingsNamespace } from './index.js'

/** Host Remote base kept behind the rc.8 compatibility boundary. */
export abstract class PaimindHostRemoteService extends TypertRemoteService {
  protected constructor(ctx: object, serviceKey: string) {
    super(ctx as Context, serviceKey)
  }
}

/** Cordis service base kept inside the compatibility boundary for PAIMind Host services. */
export abstract class PaimindHostService extends Service {
  protected constructor(ctx: object, serviceKey: string) {
    super(ctx as Context, serviceKey)
  }
}

/** Browser-safe Schedule view projected from Harness's canonical Session log. */
export interface PaimindNativeScheduleView {
  readonly id: string
  readonly kind: 'after' | 'at' | 'every'
  readonly prompt: string
  readonly scheduledAt: string
  readonly state: 'scheduled' | 'overdue'
  readonly deliveryMode: 'session-local'
  readonly afterSeconds?: number
  readonly everySeconds?: number
}

/** Structural live Session subset isolated from the feature package. */
export interface PaimindHostScheduleSession {
  readonly header: { readonly seedLength?: number }
  readonly events: readonly unknown[]
}

/** Structural native SessionStore subset used only for Schedule projection. */
export interface PaimindHostScheduleSessionStore {
  get(id: string): PaimindHostScheduleSession | undefined
}

/**
 * Fold the exact native `schedule/change` event stream for one live Session.
 * This is the only version-sensitive Schedule projection used by PAIMind.
 */
export function listPaimindNativeSchedules(
  sessions: PaimindHostScheduleSessionStore,
  sessionId: string,
  now = Date.now(),
): readonly Readonly<PaimindNativeScheduleView>[] {
  const session = sessions.get(sessionId)
  if (session === undefined) return Object.freeze([])
  const folded = foldScheduleEvents(session.events as never, session.header.seedLength)
  return Object.freeze(folded.active.map(record => {
    const view = scheduleView(record, now)
    return Object.freeze({
      id: String(view.id),
      kind: view.kind,
      prompt: view.prompt,
      scheduledAt: view.scheduledAt,
      state: view.state,
      deliveryMode: view.deliveryMode,
      ...(view.kind === 'after' ? { afterSeconds: view.afterSeconds } : {}),
      ...(view.kind === 'every' ? { everySeconds: view.everySeconds } : {}),
    })
  }))
}

/** Stable field vocabulary used to build one Harness settings namespace schema. */
export type PaimindSettingsFieldSpec =
  | {
      readonly kind: 'boolean'
      readonly default: boolean
      readonly description?: string
    }
  | {
      readonly kind: 'enum'
      readonly values: readonly [string, ...string[]]
      readonly default: string
      readonly description?: string
    }
  | {
      readonly kind: 'string'
      readonly default: string
      readonly maxLength: number
      readonly description?: string
    }

/** Structural owner handle returned by the native Harness Settings service. */
export interface PaimindHostSettingsScope<T extends object> {
  get(): Readonly<T>
  watch(callback: (next: Readonly<T>, prev: Readonly<T>) => void | Promise<void>): () => void
  update(patch: Partial<T>): Promise<void>
  replace(section: Partial<T>): Promise<void>
}

/** Structural native Settings service consumed by PAIMind owners. */
export interface PaimindHostSettingsFacility {
  readonly writable: boolean
  register<T extends object>(
    namespace: unknown,
    schema: object,
    options?: { readonly base?: Partial<T>; readonly applies?: 'live' | 'restart' },
  ): PaimindHostSettingsScope<T>
  describe(options?: { readonly redactSecrets?: boolean }): readonly {
    readonly ns: unknown
    readonly value: unknown
    readonly revision: number
    readonly user?: unknown
  }[]
  mutate(
    namespace: unknown,
    operations: readonly ({ readonly op: 'set'; readonly path: readonly string[]; readonly value: unknown }
      | { readonly op: 'unset'; readonly path: readonly string[] })[],
    expectedRevision?: number,
  ): Promise<void>
}

/** Read one PAIMind namespace through the Host-only native Settings face. */
export function describePaimindHostSettings(
  settings: PaimindHostSettingsFacility,
  namespace: string,
): { readonly value: unknown; readonly user?: unknown; readonly revision: number; readonly writable: boolean } | undefined {
  const branded = settingsNamespace(resolveHarnessSettingsNamespace(namespace))
  const descriptor = settings.describe({ redactSecrets: true })
    .find(candidate => String(candidate.ns) === String(branded))
  return descriptor === undefined ? undefined : {
    value: descriptor.value,
    ...(descriptor.user === undefined ? {} : { user: descriptor.user }),
    revision: descriptor.revision,
    writable: settings.writable,
  }
}

/** Host-internal raw user layer for one-time migrations; never expose this result over a Remote. */
export function describePaimindHostSettingsUserLayer(
  settings: PaimindHostSettingsFacility,
  namespace: string,
): { readonly user?: unknown; readonly revision: number } | undefined {
  const branded = settingsNamespace(resolveHarnessSettingsNamespace(namespace))
  const descriptor = settings.describe()
    .find(candidate => String(candidate.ns) === String(branded))
  return descriptor === undefined ? undefined : {
    ...(descriptor.user === undefined ? {} : { user: descriptor.user }),
    revision: descriptor.revision,
  }
}

export type PaimindHostSettingsMutationOperation =
  | { readonly op: 'set'; readonly path: readonly string[]; readonly value: unknown }
  | { readonly op: 'unset'; readonly path: readonly string[] }

/** Apply a bounded set of CAS-protected field operations through native Settings. */
export async function mutatePaimindHostSettingsOperations(
  settings: PaimindHostSettingsFacility,
  namespace: string,
  operations: readonly PaimindHostSettingsMutationOperation[],
  expectedRevision: number,
): Promise<void> {
  await settings.mutate(settingsNamespace(resolveHarnessSettingsNamespace(namespace)), operations, expectedRevision)
}

/** CAS-protected single-field mutation inside the canonical Host Settings document. */
export async function mutatePaimindHostSettings(
  settings: PaimindHostSettingsFacility,
  namespace: string,
  field: string,
  value: unknown,
  expectedRevision: number,
): Promise<void> {
  await mutatePaimindHostSettingsOperations(
    settings,
    namespace,
    [{ op: 'set', path: [field], value }],
    expectedRevision,
  )
}

/**
 * Register a PAIMind-owned namespace through the current native Settings API.
 * Feature packages describe product fields but never import version-sensitive
 * Harness Settings or Schemastery symbols directly.
 */
export function registerPaimindHostSettings<T extends object>(
  settings: PaimindHostSettingsFacility,
  namespace: string,
  fields: Readonly<Record<keyof T & string, PaimindSettingsFieldSpec>>,
  options?: { readonly base?: Partial<T>; readonly applies?: 'live' | 'restart' },
): PaimindHostSettingsScope<T> {
  const shape: Record<string, Schema> = {}
  for (const [field, spec] of Object.entries(fields) as [string, PaimindSettingsFieldSpec][]) {
    const schema = spec.kind === 'boolean'
      ? Schema.boolean().default(spec.default)
      : spec.kind === 'enum'
        ? Schema.union(spec.values.map(value => Schema.const(value)) as [Schema<string>, ...Schema<string>[]]).default(spec.default)
        : Schema.string().max(spec.maxLength).default(spec.default)
    shape[field] = spec.description === undefined ? schema : schema.description(spec.description)
  }
  return settings.register(
    settingsNamespace(resolveHarnessSettingsNamespace(namespace)),
    Schema.object(shape),
    options,
  ) as unknown as PaimindHostSettingsScope<T>
}

/** One exact model route used by the PAIMind auxiliary title call. */
export interface PaimindConversationTitleModelRoute {
  readonly provider: string
  readonly model: string
}

/** Minimal native Session face used by conversation auto-naming. */
export interface PaimindConversationTitleSession {
  readonly id: string
  append(type: 'session/title', data: {
    readonly title: string
    readonly messageSeqs: readonly number[]
    readonly source:
      | { readonly kind: 'fallback' }
      | { readonly kind: 'provider'; readonly provider: string; readonly model: PaimindConversationTitleModelRoute }
  }): unknown
}

/** Native event subset consumed without reading conversation history. */
export type PaimindConversationTitleSessionEvent =
  | {
      readonly type: 'user/message'
      readonly seq: number
      readonly data: {
        readonly source: { readonly kind: string }
        readonly content: readonly { readonly type: string; readonly text?: string }[]
      }
    }
  | {
      readonly type: 'request/header'
      readonly seq: number
      readonly data: { readonly header: { readonly config: PaimindConversationTitleModelRoute } }
    }
  | { readonly type: string; readonly seq: number; readonly data: unknown }

/** Current title snapshot needed for optimistic late-result protection. */
export interface PaimindConversationTitleSnapshot {
  readonly title: string
  readonly eventSeq: number
  readonly source: { readonly kind: 'fallback' | 'provider' | 'user' }
}

/** Structural Host services used by the version-isolated title adapter. */
export interface PaimindConversationTitleAutomationContext {
  readonly sessionTitle: {
    get(session: PaimindConversationTitleSession): PaimindConversationTitleSnapshot | undefined
  }
  readonly llm: {
    stream(options: {
      readonly provider: string
      readonly model: string
      readonly messages: ReturnType<typeof createUserMessage>[]
      readonly maxTokens: number
      readonly sessionId: string
      readonly purpose: 'session-title'
      readonly signal: AbortSignal
    }): AsyncIterable<unknown>
  }
  readonly logger: { warn(message: unknown): void }
  on(
    event: 'session/event',
    listener: (session: PaimindConversationTitleSession, event: PaimindConversationTitleSessionEvent) => void,
  ): () => void
  on(
    event: 'session/disposed',
    listener: (session: PaimindConversationTitleSession) => void,
  ): () => void
}

/** Product-owned policy callbacks; Harness-specific event and LLM shapes stay above. */
export interface PaimindConversationTitleAutomationOptions {
  readonly providerId: string
  readonly enabled: () => boolean
  readonly route: () => PaimindConversationTitleModelRoute | undefined
  readonly temporaryTitle: (message: string) => string
  readonly prompt: (message: string) => string
  readonly finalizeTitle: (output: string) => string | undefined
  readonly maxOutputTokens: number
  readonly timeoutMs: number
}

interface PaimindConversationTitleWork {
  readonly triggerSeq: number
  readonly triggerText: string
  readonly temporaryEventSeq: number
  readonly temporaryTitle: string
  controller?: AbortController
  started: boolean
}

function titleMessageText(event: Extract<PaimindConversationTitleSessionEvent, { readonly type: 'user/message' }>): string {
  return event.data.content
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text ?? '')
    .join('\n')
}

function titleRouteFromHeader(event: Extract<PaimindConversationTitleSessionEvent, { readonly type: 'request/header' }>): PaimindConversationTitleModelRoute | undefined {
  const { provider, model } = event.data.header.config
  return provider.length === 0 || model.length === 0 ? undefined : { provider, model }
}

/**
 * Install PAIMind conversation auto-naming over the native Session title log.
 * The exact triggering user event is retained in memory; no historical message
 * collection or shadow Session is created. The generated result commits only
 * while the same temporary title event remains current.
 */
export function installPaimindConversationTitleAutomation(
  ctx: PaimindConversationTitleAutomationContext,
  options: PaimindConversationTitleAutomationOptions,
): () => void {
  const workBySession = new Map<PaimindConversationTitleSession, PaimindConversationTitleWork>()
  let disposed = false

  const start = (
    session: PaimindConversationTitleSession,
    work: PaimindConversationTitleWork,
    route: PaimindConversationTitleModelRoute,
  ): void => {
    if (disposed || work.started) return
    work.started = true
    const controller = new AbortController()
    work.controller = controller
    const timer = setTimeout(() => {
      controller.abort(new Error('conversation title generation timed out'))
    }, options.timeoutMs)

    void (async () => {
      const assembler = new BlockAssembler()
      const prompt = options.prompt(work.triggerText)
      const message = createUserMessage({
        content: [{ type: 'text', text: prompt }],
        source: { kind: 'plugin', plugin: options.providerId },
      })
      for await (const chunk of ctx.llm.stream({
        provider: route.provider,
        model: route.model,
        messages: [message],
        maxTokens: options.maxOutputTokens,
        sessionId: session.id,
        purpose: 'session-title',
        signal: controller.signal,
      })) {
        assembler.push(chunk as Parameters<BlockAssembler['push']>[0])
      }
      if (assembler.finish.kind !== 'stop') throw new Error('conversation title model call did not finish normally')
      const text = assembler.message({ kind: 'plugin', plugin: options.providerId }).content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join(' ')
      const title = options.finalizeTitle(text)
      if (title === undefined) throw new Error('conversation title model returned no valid title')
      if (!options.enabled()) return
      const current = ctx.sessionTitle.get(session)
      if (current?.eventSeq !== work.temporaryEventSeq
        || current.title !== work.temporaryTitle
        || current.source.kind !== 'fallback') return
      session.append('session/title', {
        title,
        messageSeqs: [work.triggerSeq],
        source: { kind: 'provider', provider: options.providerId, model: route },
      })
    })().catch((error: unknown) => {
      if (!controller.signal.aborted && !disposed) {
        ctx.logger.warn(`conversation title generation failed for session "${session.id}": ${String(error)}`)
      }
    }).finally(() => {
      clearTimeout(timer)
      delete work.controller
    })
  }

  const stopEvents = ctx.on('session/event', (session, rawEvent) => {
    if (disposed || !options.enabled()) return
    if (rawEvent.type === 'user/message') {
      const event = rawEvent as Extract<PaimindConversationTitleSessionEvent, { readonly type: 'user/message' }>
      if (event.data.source.kind !== 'user' || workBySession.has(session)) return
      const triggerText = titleMessageText(event)
      const temporaryTitle = options.temporaryTitle(triggerText)
      if (temporaryTitle.length === 0) return
      queueMicrotask(() => {
        if (disposed || !options.enabled() || workBySession.has(session)) return
        const before = ctx.sessionTitle.get(session)
        // The native title service may have produced its deterministic fallback
        // later in the same user-event dispatch. Replace only that same-event
        // fallback; an older fallback or any provider/user title is already a
        // real title and must never be treated as an untitled conversation.
        if (before !== undefined && (before.source.kind !== 'fallback' || before.eventSeq <= event.seq)) return
        session.append('session/title', {
          title: temporaryTitle,
          messageSeqs: [event.seq],
          source: { kind: 'fallback' },
        })
        const current = ctx.sessionTitle.get(session)
        if (current?.source.kind !== 'fallback' || current.title !== temporaryTitle) return
        const work: PaimindConversationTitleWork = {
          triggerSeq: event.seq,
          triggerText,
          temporaryEventSeq: current.eventSeq,
          temporaryTitle,
          started: false,
        }
        workBySession.set(session, work)
        const explicit = options.route()
        if (explicit !== undefined) queueMicrotask(() => { start(session, work, explicit) })
      })
      return
    }
    if (rawEvent.type !== 'request/header') return
    const event = rawEvent as Extract<PaimindConversationTitleSessionEvent, { readonly type: 'request/header' }>
    const work = workBySession.get(session)
    if (work === undefined || work.started || event.seq <= work.triggerSeq) return
    const route = options.route() ?? titleRouteFromHeader(event)
    if (route !== undefined) queueMicrotask(() => { start(session, work, route) })
  })
  const stopDisposed = ctx.on('session/disposed', session => {
    const work = workBySession.get(session)
    work?.controller?.abort(new Error('session disposed during conversation title generation'))
    workBySession.delete(session)
  })

  return () => {
    if (disposed) return
    disposed = true
    stopEvents()
    stopDisposed()
    for (const work of workBySession.values()) {
      work.controller?.abort(new Error('conversation title automation unloaded'))
    }
    workBySession.clear()
  }
}

/** Consumer hooks for the native optional Settings lifecycle helper. */
export interface PaimindSettingsSectionHooks<T extends object> {
  setSource(current: () => Readonly<T>): void
  onChange(): void
  validate?(value: Readonly<T>): void
}

/**
 * Install one settings section through Harness's scoped optional-consumer seam.
 * This is intentionally distinct from directly calling `settings.register`:
 * the upstream helper owns attach, detach, fallback and watcher lifecycle.
 */
export function installPaimindHostSettings<T extends object>(
  ctx: object,
  namespace: string,
  fields: Readonly<Record<keyof T & string, PaimindSettingsFieldSpec>>,
  entry: T,
  hooks: PaimindSettingsSectionHooks<T>,
): void {
  const shape: Record<string, Schema> = {}
  for (const [field, spec] of Object.entries(fields) as [string, PaimindSettingsFieldSpec][]) {
    const schema = spec.kind === 'boolean'
      ? Schema.boolean().default(spec.default)
      : spec.kind === 'enum'
        ? Schema.union(spec.values.map(value => Schema.const(value)) as [Schema<string>, ...Schema<string>[]]).default(spec.default)
        : Schema.string().max(spec.maxLength).default(spec.default)
    shape[field] = spec.description === undefined ? schema : schema.description(spec.description)
  }
  installSettingsSection(
    ctx as Context,
    settingsNamespace(resolveHarnessSettingsNamespace(namespace)),
    Schema.object(shape),
    entry,
    hooks as never,
  )
}

/** Standard-decorator alias; feature packages never import Typert directly. */
export const PaimindRemote = Remote

/**
 * Register Remote markers without leaking decorator syntax into feature source.
 * This keeps Vitest/older bundlers compatible while preserving Gateway SRC fallback.
 */
export function markPaimindHostRemoteMethods(service: object, methods: readonly string[]): void {
  for (const method of methods) {
    const callable = Reflect.get(service, method)
    if (typeof callable !== 'function') throw new Error(`PAIMind Remote method "${method}" is not callable`)
    let initializer: ((this: object) => void) | undefined
    ;(Remote as unknown as (
      value: (...args: unknown[]) => unknown,
      context: {
        readonly kind: 'method'
        readonly name: string
        readonly static: false
        readonly private: false
        addInitializer(value: (this: object) => void): void
      },
    ) => void)(callable as (...args: unknown[]) => unknown, {
      kind: 'method', name: method, static: false, private: false,
      addInitializer(value) { initializer = value },
    })
    initializer?.call(service)
  }
}

/** Public Cordis Loader entry subset used by the product Feature Pack controller. */
export interface PaimindHostLoaderEntry {
  readonly id: string
  readonly options: {
    readonly id: string
    readonly name: string
    readonly group?: boolean | null
    readonly disabled?: boolean | null
  }
  /** Runtime-only entry transition; unlike Loader.update this does not rewrite the file-backed tree. */
  update?(
    options: { readonly disabled?: boolean | null },
    create?: boolean,
    force?: boolean,
  ): Promise<void>
}

/** Structural public Loader tree; version-specific classes stay behind this boundary. */
export interface PaimindHostLoaderFacility {
  entries(): Iterable<PaimindHostLoaderEntry>
  await(): Promise<void>
  resolve(id: string): PaimindHostLoaderEntry
  update(
    id: string,
    options: { readonly disabled?: boolean | null },
    parent?: string | null,
    position?: number,
  ): Promise<void>
}

export interface PaimindHostLoaderEntryState {
  readonly entryId: string
  readonly installed: boolean
  readonly enabled: boolean
}

/** Resolve a stable product-owned id even when an Include subtree prefixes the runtime id. */
function resolvePaimindHostLoaderEntry(
  loader: PaimindHostLoaderFacility,
  entryId: string,
): PaimindHostLoaderEntry | undefined {
  try {
    return loader.resolve(entryId)
  } catch {
    const matches = [...loader.entries()].filter(entry => entry.options.id === entryId)
    if (matches.length > 1) {
      throw new Error(`PAIMind Loader entry "${entryId}" is ambiguous (${matches.length} matches)`)
    }
    return matches[0]
  }
}

/** Read one exact composition-group row without inferring state from child packages. */
export function describePaimindHostLoaderEntry(
  loader: PaimindHostLoaderFacility,
  entryId: string,
): Readonly<PaimindHostLoaderEntryState> {
  const entry = resolvePaimindHostLoaderEntry(loader, entryId)
  if (entry === undefined) return Object.freeze({ entryId, installed: false, enabled: false })
  return Object.freeze({
    entryId,
    installed: true,
    enabled: entry.options.disabled !== true,
  })
}

/** Toggle an exact public Loader entry and let Cordis own disposal, restore, and persistence. */
export async function setPaimindHostLoaderEntryEnabled(
  loader: PaimindHostLoaderFacility,
  entryId: string,
  enabled: boolean,
): Promise<void> {
  const entry = resolvePaimindHostLoaderEntry(loader, entryId)
  if (entry === undefined) throw new Error(`PAIMind Loader entry "${entryId}" is not installed`)
  if ((entry.options.disabled !== true) === enabled) return
  const patch = { disabled: enabled ? null : true }
  // Product switch persistence belongs to Harness Settings. Keep the file-backed
  // Loader tree inert at bootstrap so a physically absent package can still boot
  // when its owning Product Pack is off.
  if (entry.update !== undefined) await entry.update(patch)
  else await loader.update(entry.id, patch)
}

/** Public storage-domain helpers isolated from feature package manifests. */
export function definePaimindStorageDomain(spec: Readonly<Record<string, unknown>>): unknown {
  return defineDomain(spec as never)
}

export function paimindDomainTable(schema: object): unknown {
  return domainTable(schema as never)
}

/** Structural durable table used by PAIMind-owned sidecars. */
export interface PaimindStorageTable<Value> {
  get(key: string): Value | undefined
  entries(): IterableIterator<[string, Value]>
  readonly size: number
  put(key: string, value: Value): Promise<void>
  delete(key: string): Promise<boolean>
  update(key: string, transform: (current: Value) => Value): Promise<Value>
}

export interface PaimindStorageDomainHandle {
  table(name: string): PaimindStorageTable<unknown>
  close(): Promise<void>
}

export interface PaimindStorageDomainFacility {
  open(spec: unknown): Promise<PaimindStorageDomainHandle>
}

export type PaimindJsonPrimitive = string | number | boolean | null
export type PaimindJsonValue = unknown

export interface PaimindContentBlock {
  readonly type: string
  readonly [key: string]: unknown
}

export interface PaimindHostAgent {
  readonly id: string
  readonly session: {
    readonly id: string
    readonly header: { readonly cwd?: string; readonly agentPreset?: string }
  }
}

export interface PaimindToolRunContext {
  readonly callId: string
  readonly rootCallId: string
  readonly name: string
  readonly arguments: unknown
  readonly agent?: PaimindHostAgent
  readonly parent?: symbol
  readonly token: symbol
  readonly signal: AbortSignal
}

export interface PaimindToolExecutionSuccess {
  readonly isError: false
  readonly value: PaimindJsonValue
  readonly content: readonly PaimindContentBlock[]
  readonly meta?: PaimindJsonValue
}

export interface PaimindToolExecutionFailure {
  readonly isError: true
  readonly content: readonly PaimindContentBlock[]
  readonly error?: { readonly message?: string }
  readonly meta?: PaimindJsonValue
}

export type PaimindToolExecutionResult = PaimindToolExecutionSuccess | PaimindToolExecutionFailure

export interface PaimindToolResultPresentation {
  readonly content: readonly PaimindContentBlock[]
  readonly isError: boolean
  readonly meta?: PaimindJsonValue
}

export interface PaimindHarnessToolDefinitionOptions {
  readonly name: string
  readonly description: string
  readonly parameters: Readonly<Record<string, unknown>>
  readonly output: {
    readonly schema: Readonly<Record<string, unknown>>
    render(args: Record<string, unknown>, value: Record<string, unknown>): PaimindContentBlock[]
    presentationMeta?(args: Record<string, unknown>, value: Record<string, unknown>): PaimindJsonValue
  }
  execute(args: Record<string, unknown>, exec: PaimindToolRunContext): Promise<Record<string, unknown>>
  presentCall?(args: Record<string, unknown>): Readonly<Record<string, unknown>> | undefined
  presentResult?(
    args: Record<string, unknown>,
    result: PaimindToolResultPresentation,
  ): Readonly<Record<string, unknown>> | undefined
  isConcurrencySafe?(args: Record<string, unknown>): boolean
}

/**
 * The only runtime bridge to Harness's version-sensitive Tool Definition helper.
 * Feature packages depend on this stable structural contract instead of importing
 * `@deepseek-ai/dsh-tools` directly.
 */
export function definePaimindHarnessTool(options: PaimindHarnessToolDefinitionOptions): unknown {
  return defineTool(options as never)
}

export interface PaimindNativeJobSnapshot {
  readonly id: string
  readonly kind: string
  readonly label: string
  readonly status: 'running' | 'stopping' | 'completed' | 'killed' | 'failed'
  readonly detail?: string
  readonly startedAt: number
  readonly finishedAt?: number
}

export interface PaimindNativeJobRegistry {
  start(spec: {
    readonly kind: string
    readonly label: string
    readonly owner?: PaimindHostAgent
    run(): {
      cancel(reason?: string): void
      done: Promise<{
        readonly status: 'completed' | 'killed' | 'failed'
        readonly detail?: string
        readonly output?: string
      }>
    }
  }): string
  get(id: string, caller?: PaimindHostAgent): PaimindNativeJobSnapshot
  kill(id: string, caller?: PaimindHostAgent, reason?: string): 'requested' | 'already-finished'
}

export interface PaimindHostToolRegistry {
  register(definition: unknown): () => void
  execute(input: {
    readonly callId: string
    readonly rootCallId?: string
    readonly name: string
    readonly arguments: unknown
    readonly agent?: PaimindHostAgent
    readonly parent?: symbol
    readonly signal: AbortSignal
  }): Promise<PaimindToolExecutionResult>
}

export interface PaimindHostSystemPrompt {
  section(input: { readonly name: string; readonly order?: number; readonly text: string }): () => void
  context(input: { readonly name: string; readonly order: number; readonly text: string }): () => void
}

export interface PaimindHostFsTarget {
  readonly displayPath: string
}

export interface PaimindHostFileSystem {
  resolve(path: string, options?: { readonly cwd?: string; readonly signal?: AbortSignal }): Promise<PaimindHostFsTarget>
  contains(parent: PaimindHostFsTarget, child: PaimindHostFsTarget): boolean
  stat(target: PaimindHostFsTarget, signal?: AbortSignal): Promise<{
    readonly type: 'file' | 'directory' | 'other'
    readonly size?: number
  } | undefined>
}

export interface PaimindHostWorkspace {
  readonly id: string
  readonly path: string
  readonly sessionIds: readonly string[]
}

export interface PaimindHostWorkspaceRegistry {
  list(): readonly PaimindHostWorkspace[]
}

export interface PaimindSessionEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: unknown
}

/** Exact native Session face required by the Schedule v1 read adapter. */
export interface PaimindScheduledHarnessAgent {
  readonly id: string
  readonly session: {
    readonly id: string
    readonly header: { readonly cwd?: string; readonly agentPreset?: string }
    readonly events: readonly PaimindSessionEvent[]
  }
  followup(message: unknown): void
  whenIdle(): Promise<void>
}

export interface PaimindScheduledHarnessAgentHandle {
  readonly agent: PaimindScheduledHarnessAgent
  dispose(): Promise<void>
}

export interface PaimindScheduledHarnessAgentRegistry {
  create(options: {
    readonly sessionId: string
    readonly meta?: { readonly cwd?: string; readonly agentPreset?: string }
    readonly agentOptions?: { readonly provider?: string; readonly model?: string }
    readonly signal?: AbortSignal
    readonly setup?: (agentCtx: object) => void | Promise<void>
  }): Promise<PaimindScheduledHarnessAgentHandle>
}

/** Structural preset face used only while creating an independent scheduled Session. */
export interface PaimindScheduledHarnessPresetRegistry {
  resolve(id?: string): Promise<{ readonly id: string }>
  mount(agentCtx: object, id?: string): Promise<unknown>
}

/** Structural native title service; exact Harness imports stay inside this compatibility boundary. */
export interface PaimindScheduledHarnessTitleService {
  rename(session: PaimindHostAgent['session'], title: string): unknown
}

/** Structural default model route used when creating an autonomous Session outside ApiProxy. */
export interface PaimindHarnessDefaultModelService {
  currentSelection(): { readonly provider: string; readonly model: string; readonly reasoningEffort?: string }
}

/**
 * Create a scheduled Agent inside the same preset composition used by normal
 * Harness Sessions. Mounting during the unpublished setup window is required:
 * it makes scoped tools and the native Job controller available before the
 * Agent can run, while keeping rc-specific setup semantics out of the Adapter.
 */
export async function createPaimindScheduledHarnessAgent(
  agents: PaimindScheduledHarnessAgentRegistry,
  presets: PaimindScheduledHarnessPresetRegistry | undefined,
  options: {
    readonly sessionId: string
    readonly cwd?: string
    readonly agentPreset?: string
    readonly provider?: string
    readonly model?: string
    readonly signal?: AbortSignal
  },
): Promise<PaimindScheduledHarnessAgentHandle> {
  if ((options.provider === undefined) !== (options.model === undefined)) {
    throw new Error('scheduled Harness Agent requires provider and model together')
  }
  const modelOptions = options.provider === undefined || options.model === undefined
    ? {}
    : { agentOptions: { provider: options.provider, model: options.model } }
  if (presets === undefined) {
    return await agents.create({
      sessionId: options.sessionId,
      ...(options.cwd === undefined ? {} : { meta: { cwd: options.cwd } }),
      ...modelOptions,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  }
  const preset = await presets.resolve(options.agentPreset)
  return await agents.create({
    sessionId: options.sessionId,
    meta: {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      agentPreset: preset.id,
    },
    ...modelOptions,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    setup: async agentCtx => { await presets.mount(agentCtx, preset.id) },
  })
}

/** Create a user-owned scheduled turn so native conversation title/index services can surface it. */
export function createPaimindHarnessScheduledMessage(text: string): unknown {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  })
}

export interface PaimindScheduledHarnessResult {
  readonly status: 'succeeded' | 'failed' | 'needs_attention'
  readonly message: string
}

function boundedHarnessResultMessage(value: string): string {
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return (normalized === '' ? 'Harness Session completed' : normalized).slice(0, 4_096)
}

/** Map the final native Session log into the platform's deliberately small result vocabulary. */
export function readPaimindScheduledHarnessResult(
  agent: PaimindScheduledHarnessAgent,
): Readonly<PaimindScheduledHarnessResult> {
  const assistant = [...agent.session.events].reverse().find(event => event.type === 'assistant/message')
  const failedTool = [...agent.session.events].reverse().find(event => {
    if (event.type !== 'tool/result' || typeof event.data !== 'object' || event.data === null) return false
    return 'error' in event.data && event.data.error !== undefined
  })
  if (assistant === undefined && failedTool !== undefined) {
    const data = failedTool.data as { readonly error?: { readonly code?: string; readonly name?: string } }
    return Object.freeze({
      status: 'failed',
      message: boundedHarnessResultMessage(data.error?.code ?? data.error?.name ?? 'Harness tool execution failed'),
    })
  }
  if (assistant === undefined || typeof assistant.data !== 'object' || assistant.data === null) {
    return Object.freeze({ status: 'failed', message: 'Harness Session finished without an assistant result' })
  }
  const message = (assistant.data as {
    readonly message?: { readonly content?: readonly { readonly type?: string; readonly text?: string }[] }
  }).message
  const text = message?.content
    ?.filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n') ?? ''
  const needsAttention = /PAIMIND_STATUS\s*:\s*NEEDS_ATTENTION/i.test(text)
  const clean = text.replace(/PAIMIND_STATUS\s*:\s*(?:SUCCEEDED|NEEDS_ATTENTION)/ig, '')
  return Object.freeze({
    status: needsAttention ? 'needs_attention' : 'succeeded',
    message: boundedHarnessResultMessage(clean),
  })
}

/** Harness 0.1.1 client-visible Session Projection registration shape. */
export interface PaimindSessionProjectionDefinition<State, View = unknown> {
  readonly key: string
  readonly stateSchema: { parse(value: unknown): State }
  init(): State
  apply(state: State, event: PaimindSessionEvent): State
  readonly wire: {
    readonly viewSchema: { parse(value: unknown): View }
    view(state: State): View
  }
  readonly stateVersion: number
}

export interface PaimindHostSessionProjectionRegistry {
  register<State, View>(definition: PaimindSessionProjectionDefinition<State, View>): () => void
  snapshot(session: PaimindHostAgent['session']): {
    readonly asOfSeq: number
    readonly values: Readonly<Record<string, unknown>>
  }
}

export interface PaimindHostReflectRegistry {
  provide(name: string, service: unknown): () => void | Promise<void>
}

export interface PaimindArtifactRuntimeHostContext {
  readonly jobs: PaimindNativeJobRegistry
  readonly tools: PaimindHostToolRegistry
  readonly fs: PaimindHostFileSystem
  readonly workspaceRegistry: PaimindHostWorkspaceRegistry
  readonly sessionProjections: PaimindHostSessionProjectionRegistry
  readonly reflect: PaimindHostReflectRegistry
  effect(install: () => void | (() => void), label?: string): void
  on(
    event: 'tools/execute',
    listener: (
      exec: PaimindToolRunContext,
      next: () => Promise<PaimindToolExecutionResult>,
    ) => Promise<PaimindToolExecutionResult>,
  ): () => void
}
