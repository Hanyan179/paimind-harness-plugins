/** Stable PAIMind feature-package identifiers used by the migration ledger. */
export const FEATURE_PACKAGE_IDS = [
  'FP01', 'FP02', 'FP03', 'FP04', 'FP05', 'FP06', 'FP07', 'FP08',
  'FP09', 'FP10', 'FP11', 'FP12', 'FP13', 'FP14', 'FP15', 'FP16',
] as const

/** One independently verifiable execution unit in the PAIMind migration program. */
export type FeaturePackageId = typeof FEATURE_PACKAGE_IDS[number]

/** Internal Harness foundation used by every PAIMind-created Agent. */
export const PAIMIND_STANDARD_AGENT_BASE_PRESET_ID = 'standard' as const

/**
 * DSH-home-relative repository for business Skill packages managed by PAIMind.
 * Harness default Skill discovery must never scan this repository directly.
 */
export const PAIMIND_BUSINESS_SKILL_REPOSITORY_DIRECTORY = '.paimind-skill-market/skills' as const

/** Creator-Agent Tool that transfers a complete proposal into the reviewable UI draft. */
export const PAIMIND_AGENT_PREPARE_CREATE_TOOL = 'paimind_agent_prepare_create' as const

/** Autonomous verification lifecycle shared by migration documents and diagnostics. */
export type VerificationState =
  | 'not-started'
  | 'grounded'
  | 'contracted'
  | 'implemented'
  | 'verified'

/** Opaque reference to a Harness Workspace; PAIMind does not mint a second Project identity. */
export interface ProjectRef {
  readonly workspaceId: string
}

/** File or generated output surfaced by a PAIMind renderer. */
export interface ArtifactRef {
  readonly workspaceId: string
  readonly sessionId: string
  readonly artifactId: string
  readonly mediaType: string
  readonly displayName: string
  readonly traceId?: string
}

/** Durable semantic artifact kinds emitted by PAIMind generators. */
export const PAIMIND_ARTIFACT_EVENT_KINDS = [
  'pptx', 'pdf', 'xlsx', 'html', 'bento', 'json',
] as const

export type PaimindArtifactEventKind = typeof PAIMIND_ARTIFACT_EVENT_KINDS[number]

/** Stable preview channels; renderers register against these values explicitly. */
export const PAIMIND_ARTIFACT_PREVIEW_CHANNELS = [
  'presentation', 'pdf', 'spreadsheet', 'html-document', 'html-deck', 'bento-deck', 'data-document',
] as const

export type PaimindArtifactPreviewChannel = typeof PAIMIND_ARTIFACT_PREVIEW_CHANNELS[number]

export type PaimindArtifactProducedState = 'available' | 'failed' | 'superseded'

/** Exact native Harness Job kind shared by every PAIMind artifact producer and consumer. */
export const PAIMIND_ARTIFACT_JOB_KIND = 'paimind-artifact' as const

export interface PaimindArtifactProducedError {
  readonly code: string
  readonly message: string
}

/**
 * Versioned artifact fact carried inside the native Harness `tool/result.meta` event.
 * Session, Workspace, Job and file identities are all native Harness identities; PAIMind
 * adds only explicit product semantics and never infers them from prose or filenames.
 */
export interface ArtifactProducedEnvelopeV1 {
  readonly schema: 'paimind.artifact-produced/v1'
  readonly artifactId: string
  readonly sessionId: string
  readonly workspaceId: string
  readonly path: string
  readonly title: string
  readonly kind: PaimindArtifactEventKind
  readonly previewKind: PaimindArtifactPreviewChannel
  readonly revision: number
  readonly producerId: string
  readonly taskId: string
  readonly traceId?: string
  readonly state: PaimindArtifactProducedState
  readonly producedAt: number
  readonly error?: PaimindArtifactProducedError
}

/**
 * Structured provenance emitted by the same generator execution as its Artifact fact.
 * The document remains producer-defined here and is normalized by the Presentation Trace
 * package before it can reach a browser surface.
 */
export interface ArtifactTraceEnvelopeV1 {
  readonly schema: 'paimind.artifact-trace/v1'
  readonly traceId: string
  readonly artifactId: string
  readonly sessionId: string
  readonly workspaceId: string
  readonly producerId: string
  readonly taskId: string
  readonly artifactRevision: number
  readonly producedAt: number
  readonly document: unknown
}

/** Browser-safe reference to a large trace sidecar retained in the Harness Workspace. */
export interface ArtifactTraceDocumentRefV2 {
  readonly path: string
  readonly schema: string
  readonly sha256: string
  readonly bytes: number
}

/**
 * Large provenance documents stay out of Session projections. Consumers must load the
 * referenced Workspace file through a trusted Host route and verify both hash and schema.
 */
export interface ArtifactTraceEnvelopeV2 {
  readonly schema: 'paimind.artifact-trace/v2'
  readonly traceId: string
  readonly artifactId: string
  readonly sessionId: string
  readonly workspaceId: string
  readonly producerId: string
  readonly taskId: string
  readonly artifactRevision: number
  readonly producedAt: number
  readonly documentRef: ArtifactTraceDocumentRefV2
}

export type ArtifactTraceEnvelope = ArtifactTraceEnvelopeV1 | ArtifactTraceEnvelopeV2

/** Tool-private metadata wrapper; the outer shape avoids collisions with other tools. */
export interface PaimindArtifactToolMetaV1 {
  readonly schema: 'paimind.tool-result/v1'
  readonly artifact: ArtifactProducedEnvelopeV1
  readonly trace?: ArtifactTraceEnvelope
}

/** Browser-safe whole-value projection folded from native tool-result events. */
export interface PaimindArtifactProjectionV1 {
  readonly schema: 'paimind.artifacts/v1'
  readonly artifacts: readonly ArtifactProducedEnvelopeV1[]
  readonly traces: readonly ArtifactTraceEnvelope[]
}

const ARTIFACT_EVENT_KIND_SET = new Set<string>(PAIMIND_ARTIFACT_EVENT_KINDS)
const ARTIFACT_PREVIEW_CHANNEL_SET = new Set<string>(PAIMIND_ARTIFACT_PREVIEW_CHANNELS)
const ARTIFACT_STATE_SET = new Set<string>(['available', 'failed', 'superseded'])
const ARTIFACT_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/

const ARTIFACT_PREVIEW_BY_KIND: Readonly<Record<PaimindArtifactEventKind, ReadonlySet<PaimindArtifactPreviewChannel>>> = {
  pptx: new Set(['presentation']),
  pdf: new Set(['pdf']),
  xlsx: new Set(['spreadsheet']),
  html: new Set(['html-document', 'html-deck']),
  bento: new Set(['bento-deck']),
  json: new Set(['data-document']),
}

/** Validate one untrusted candidate before it enters a projection or browser surface. */
export function defineArtifactProducedEnvelope(
  candidate: ArtifactProducedEnvelopeV1,
): Readonly<ArtifactProducedEnvelopeV1> {
  if (candidate.schema !== 'paimind.artifact-produced/v1') throw new Error('unsupported artifact event schema')
  for (const [field, value] of [
    ['artifactId', candidate.artifactId],
    ['sessionId', candidate.sessionId],
    ['workspaceId', candidate.workspaceId],
    ['producerId', candidate.producerId],
    ['taskId', candidate.taskId],
  ] as const) {
    if (!ARTIFACT_ID.test(value)) throw new Error(`invalid artifact event ${field}`)
  }
  if (candidate.traceId !== undefined && !ARTIFACT_ID.test(candidate.traceId)) {
    throw new Error('invalid artifact event traceId')
  }
  if (candidate.path.trim() === '' || CONTROL_CHARACTER.test(candidate.path)) {
    throw new Error('invalid artifact event path')
  }
  if (candidate.title.trim() === '' || CONTROL_CHARACTER.test(candidate.title)) {
    throw new Error('invalid artifact event title')
  }
  if (!ARTIFACT_EVENT_KIND_SET.has(candidate.kind)) throw new Error('invalid artifact event kind')
  if (!ARTIFACT_PREVIEW_CHANNEL_SET.has(candidate.previewKind)) throw new Error('invalid artifact preview channel')
  if (!ARTIFACT_PREVIEW_BY_KIND[candidate.kind].has(candidate.previewKind)) {
    throw new Error('artifact kind and preview channel do not match')
  }
  if (!ARTIFACT_STATE_SET.has(candidate.state)) throw new Error('invalid artifact event state')
  if (!Number.isSafeInteger(candidate.revision) || candidate.revision < 1) {
    throw new Error('artifact event revision must be a positive integer')
  }
  if (!Number.isSafeInteger(candidate.producedAt) || candidate.producedAt < 0) {
    throw new Error('artifact event producedAt must be a non-negative integer')
  }
  if (candidate.state === 'failed' && candidate.error === undefined) {
    throw new Error('failed artifact event requires an error')
  }
  if (candidate.state !== 'failed' && candidate.error !== undefined) {
    throw new Error('only failed artifact events may carry an error')
  }
  const error = candidate.error === undefined
    ? undefined
    : Object.freeze({
        code: requiredText(candidate.error.code, 'artifact error code'),
        message: requiredText(candidate.error.message, 'artifact error message'),
      })
  return Object.freeze({
    ...candidate,
    title: candidate.title.trim(),
    ...(error === undefined ? {} : { error }),
  })
}

/** Narrow the native tool-private metadata carrier into a validated PAIMind artifact fact. */
export function artifactProducedFromToolMeta(meta: unknown): Readonly<ArtifactProducedEnvelopeV1> | null {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return null
  const wrapper = meta as Partial<PaimindArtifactToolMetaV1>
  if (wrapper.schema !== 'paimind.tool-result/v1' || wrapper.artifact === undefined) return null
  try {
    return defineArtifactProducedEnvelope(wrapper.artifact)
  } catch {
    return null
  }
}

/** Validate structured provenance before the native Session projection retains it. */
export function defineArtifactTraceEnvelope(
  candidate: ArtifactTraceEnvelopeV1,
): Readonly<ArtifactTraceEnvelopeV1>
export function defineArtifactTraceEnvelope(
  candidate: ArtifactTraceEnvelopeV2,
): Readonly<ArtifactTraceEnvelopeV2>
export function defineArtifactTraceEnvelope(
  candidate: ArtifactTraceEnvelope,
): Readonly<ArtifactTraceEnvelope>
export function defineArtifactTraceEnvelope(
  candidate: ArtifactTraceEnvelope,
): Readonly<ArtifactTraceEnvelope> {
  if (candidate.schema !== 'paimind.artifact-trace/v1' && candidate.schema !== 'paimind.artifact-trace/v2') {
    throw new Error('unsupported artifact trace schema')
  }
  for (const [field, value] of [
    ['traceId', candidate.traceId],
    ['artifactId', candidate.artifactId],
    ['sessionId', candidate.sessionId],
    ['workspaceId', candidate.workspaceId],
    ['producerId', candidate.producerId],
    ['taskId', candidate.taskId],
  ] as const) {
    if (!ARTIFACT_ID.test(value)) throw new Error(`invalid artifact trace ${field}`)
  }
  if (!Number.isSafeInteger(candidate.artifactRevision) || candidate.artifactRevision < 1) {
    throw new Error('artifact trace revision must be a positive integer')
  }
  if (!Number.isSafeInteger(candidate.producedAt) || candidate.producedAt < 0) {
    throw new Error('artifact trace producedAt must be a non-negative integer')
  }
  if (candidate.schema === 'paimind.artifact-trace/v1') {
    if (typeof candidate.document !== 'object' || candidate.document === null || Array.isArray(candidate.document)) {
      throw new Error('artifact trace document must be an object')
    }
  } else {
    if (candidate.documentRef.path.trim() === '' || CONTROL_CHARACTER.test(candidate.documentRef.path)) {
      throw new Error('artifact trace document reference has an invalid path')
    }
    if (candidate.documentRef.schema.trim() === '' || CONTROL_CHARACTER.test(candidate.documentRef.schema)) {
      throw new Error('artifact trace document reference has an invalid schema')
    }
    if (!/^[a-f0-9]{64}$/.test(candidate.documentRef.sha256)) {
      throw new Error('artifact trace document reference has an invalid sha256')
    }
    if (!Number.isSafeInteger(candidate.documentRef.bytes) || candidate.documentRef.bytes < 2) {
      throw new Error('artifact trace document reference has an invalid byte size')
    }
  }
  return Object.freeze({ ...candidate })
}

/** Narrow the same native tool-result metadata into a validated trace fact. */
export function artifactTraceFromToolMeta(meta: unknown): Readonly<ArtifactTraceEnvelope> | null {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return null
  const wrapper = meta as Partial<PaimindArtifactToolMetaV1>
  if (wrapper.schema !== 'paimind.tool-result/v1' || wrapper.trace === undefined) return null
  try {
    return defineArtifactTraceEnvelope(wrapper.trace)
  } catch {
    return null
  }
}

/** Validate and freeze the whole client projection value. */
export function defineArtifactProjection(
  candidate: PaimindArtifactProjectionV1,
): Readonly<PaimindArtifactProjectionV1> {
  if (candidate.schema !== 'paimind.artifacts/v1' || !Array.isArray(candidate.artifacts)) {
    throw new Error('invalid PAIMind artifact projection')
  }
  const traces = (candidate as Partial<PaimindArtifactProjectionV1>).traces
  if (traces !== undefined && !Array.isArray(traces)) throw new Error('invalid PAIMind artifact trace projection')
  return Object.freeze({
    schema: 'paimind.artifacts/v1',
    artifacts: Object.freeze(candidate.artifacts.map(defineArtifactProducedEnvelope)),
    traces: Object.freeze((traces ?? []).map(defineArtifactTraceEnvelope)),
  })
}

/** Notification severity is presentation metadata, never linked workflow state. */
export const PAIMIND_NOTIFICATION_LEVELS = ['info', 'success', 'warning', 'error'] as const
export type PaimindNotificationLevel = typeof PAIMIND_NOTIFICATION_LEVELS[number]

/** Trusted producer identity is assigned by the Host registration boundary. */
export interface PaimindNotificationSource {
  readonly id: string
  readonly nameZh: string
  readonly nameEn: string
}

/**
 * Closed safe-link vocabulary. Every internal target carries canonical Harness
 * identifiers; external links are HTTPS-only and are opened with browser isolation.
 */
export type PaimindNotificationTarget =
  | {
      readonly kind: 'artifact'
      readonly artifactId: string
      readonly sessionId: string
      readonly workspaceId: string
    }
  | { readonly kind: 'session'; readonly sessionId: string }
  | { readonly kind: 'surface'; readonly surfaceId: `paimind:${string}` }
  | { readonly kind: 'external'; readonly url: string; readonly label?: string }

/** Lightweight message/read-state sidecar; linked object lifecycle stays canonical. */
export interface NotificationRecord {
  readonly id: string
  readonly source: PaimindNotificationSource
  readonly title: string
  readonly body?: string
  readonly level: PaimindNotificationLevel
  readonly createdAt: number
  readonly readAt?: number
  readonly version: string
  readonly recipientIds?: readonly string[]
  readonly target?: PaimindNotificationTarget
}

/** Producer payload deliberately excludes source identity and all workflow status. */
export interface PaimindNotificationPublishInput {
  readonly idempotencyKey: string
  readonly recipientIds?: readonly string[]
  readonly title: string
  readonly body?: string
  readonly level: PaimindNotificationLevel
  readonly target?: PaimindNotificationTarget
}

const NOTIFICATION_LEVEL_SET = new Set<string>(PAIMIND_NOTIFICATION_LEVELS)
const NOTIFICATION_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/

function notificationText(value: string, field: string, maxLength: number): string {
  const normalized = value.trim()
  if (normalized === '' || normalized.length > maxLength || CONTROL_CHARACTER.test(normalized)) {
    throw new Error(`invalid notification ${field}`)
  }
  return normalized
}

/** Validate a closed notification target before persistence or navigation. */
export function defineNotificationTarget(
  candidate: PaimindNotificationTarget,
): Readonly<PaimindNotificationTarget> {
  if (candidate.kind === 'artifact') {
    for (const value of [candidate.artifactId, candidate.sessionId, candidate.workspaceId]) {
      if (!NOTIFICATION_ID.test(value)) throw new Error('invalid notification artifact target')
    }
  } else if (candidate.kind === 'session') {
    if (!NOTIFICATION_ID.test(candidate.sessionId)) throw new Error('invalid notification session target')
  } else if (candidate.kind === 'surface') {
    if (!/^paimind:[a-z0-9][a-z0-9-]*$/.test(candidate.surfaceId)) {
      throw new Error('invalid notification surface target')
    }
  } else {
    let url: URL
    try { url = new URL(candidate.url) } catch { throw new Error('invalid notification external target') }
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
      throw new Error('notification external target must be credential-free HTTPS')
    }
    if (candidate.label !== undefined) notificationText(candidate.label, 'action label', 80)
  }
  return Object.freeze({ ...candidate })
}

/** Validate and freeze a Host-owned notification snapshot. */
export function defineNotificationRecord(candidate: NotificationRecord): Readonly<NotificationRecord> {
  if (!NOTIFICATION_ID.test(candidate.id) || !NOTIFICATION_ID.test(candidate.version)) {
    throw new Error('invalid notification identity')
  }
  if (!NOTIFICATION_ID.test(candidate.source.id)) throw new Error('invalid notification source')
  if (!NOTIFICATION_LEVEL_SET.has(candidate.level)) throw new Error('invalid notification level')
  if (!Number.isSafeInteger(candidate.createdAt) || candidate.createdAt < 0) {
    throw new Error('invalid notification createdAt')
  }
  if (
    candidate.readAt !== undefined
    && (!Number.isSafeInteger(candidate.readAt) || candidate.readAt < candidate.createdAt)
  ) throw new Error('invalid notification readAt')
  const body = candidate.body === undefined
    ? undefined
    : notificationText(candidate.body, 'body', 4_096)
  const target = candidate.target === undefined ? undefined : defineNotificationTarget(candidate.target)
  const recipientIds = candidate.recipientIds === undefined
    ? undefined
    : Object.freeze([...new Set(candidate.recipientIds.map(value => {
        if (!NOTIFICATION_ID.test(value)) throw new Error('invalid notification recipient')
        return value
      }))])
  if (recipientIds !== undefined && (recipientIds.length === 0 || recipientIds.length > 500)) {
    throw new Error('invalid notification recipients')
  }
  return Object.freeze({
    ...candidate,
    source: Object.freeze({
      id: candidate.source.id,
      nameZh: notificationText(candidate.source.nameZh, 'source nameZh', 80),
      nameEn: notificationText(candidate.source.nameEn, 'source nameEn', 80),
    }),
    title: notificationText(candidate.title, 'title', 240),
    ...(recipientIds === undefined ? {} : { recipientIds }),
    ...(body === undefined ? {} : { body }),
    ...(target === undefined ? {} : { target }),
  })
}

/** Platform Scheduler is independent from Harness's native Session reminder domain. */
export const PAIMIND_SCHEDULE_RULE_KINDS = ['once', 'daily', 'weekdays', 'weekly', 'monthly'] as const
export type PaimindScheduleRuleKind = typeof PAIMIND_SCHEDULE_RULE_KINDS[number]

export type PaimindScheduleRule =
  | { readonly kind: 'once'; readonly at: string }
  | { readonly kind: 'daily'; readonly time: string }
  | { readonly kind: 'weekdays'; readonly time: string }
  | { readonly kind: 'weekly'; readonly weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7; readonly time: string }
  | { readonly kind: 'monthly'; readonly dayOfMonth: number; readonly time: string }

export const PAIMIND_SCHEDULE_ACTION_CATEGORIES = [
  'ai', 'workflow', 'message', 'integration', 'health-check',
] as const
export type PaimindScheduleActionCategory = typeof PAIMIND_SCHEDULE_ACTION_CATEGORIES[number]

/** Business-visible action metadata. Invocation details remain Adapter-owned. */
export interface PaimindScheduleActionDescriptor {
  readonly actionId: string
  readonly source: PaimindNotificationSource
  readonly nameZh: string
  readonly nameEn: string
  readonly descriptionZh?: string
  readonly descriptionEn?: string
  /** Explicit opt-in for the hidden conversational orchestration layer. */
  readonly conversationEnabled?: boolean
  /** Agent-facing routing guidance; never rendered as a technical task type. */
  readonly usageHint?: string
  readonly category: PaimindScheduleActionCategory
  readonly adapterId: string
  readonly enabled: boolean
  readonly version: string
}

export type PaimindScheduleDefinitionStatus = 'enabled' | 'paused' | 'archived'
export type PaimindScheduleRunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'needs_attention'
export type PaimindScheduleRunTrigger = 'schedule' | 'manual'

/** A run may open one Harness Session or one allowlisted external business page. */
export type PaimindScheduleRunAction =
  | { readonly kind: 'session'; readonly label: string; readonly sessionId: string }
  | { readonly kind: 'external'; readonly label: string; readonly url: string }

export type PaimindScheduleJsonPrimitive = string | number | boolean | null
export type PaimindScheduleJsonValue =
  | PaimindScheduleJsonPrimitive
  | readonly PaimindScheduleJsonValue[]
  | { readonly [key: string]: PaimindScheduleJsonValue }
export type PaimindScheduleActionInput = Readonly<Record<string, PaimindScheduleJsonValue>>

/** Durable business definition; provider execution remains Adapter-owned. */
export interface PaimindScheduleDefinition {
  readonly scheduleId: string
  readonly name: string
  readonly actionId: string
  readonly actionInput?: PaimindScheduleActionInput
  /** Native Harness Session where the business user configured this task. */
  readonly sourceSessionId?: string
  readonly rule: PaimindScheduleRule
  readonly timeZone: string
  readonly status: PaimindScheduleDefinitionStatus
  readonly nextRunAt?: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly archivedAt?: string
  readonly version: string
}

export interface PaimindScheduleRun {
  readonly runId: string
  readonly idempotencyKey: string
  readonly scheduleId: string
  readonly actionId: string
  /** Manual runs are user-requested and never change the definition's next occurrence. */
  readonly trigger: PaimindScheduleRunTrigger
  readonly scheduledFor: string
  readonly status: PaimindScheduleRunStatus
  readonly attempt: number
  readonly createdAt: string
  readonly startedAt?: string
  readonly finishedAt?: string
  readonly message?: string
  readonly progress?: number
  readonly action?: PaimindScheduleRunAction
  readonly version: string
}

export interface PaimindScheduleAuditRecord {
  readonly auditId: string
  readonly scheduleId: string
  readonly actorId: string
  readonly operation: 'created' | 'updated' | 'paused' | 'resumed' | 'archived' | 'restored' | 'dispatched' | 'manual_dispatched'
  readonly occurredAt: string
  readonly version: string
}

export interface PaimindScheduleCreateInput {
  readonly name: string
  readonly actionId: string
  readonly actionInput?: PaimindScheduleActionInput
  readonly sourceSessionId?: string
  readonly rule: PaimindScheduleRule
  readonly timeZone: string
  readonly enabled: boolean
}

export interface PaimindScheduleUpdateInput extends PaimindScheduleCreateInput {
  readonly scheduleId: string
  readonly ifVersion: string
}

/** Standard Adapter dispatch envelope. Callback authentication is out-of-band. */
export interface PaimindScheduleTriggerRequest {
  readonly contractVersion: '1.0'
  readonly runId: string
  readonly scheduleId: string
  readonly scheduleName: string
  readonly actionId: string
  readonly actionInput?: PaimindScheduleActionInput
  readonly sourceSessionId?: string
  readonly trigger: PaimindScheduleRunTrigger
  readonly scheduledFor: string
  readonly idempotencyKey: string
  readonly callbackUrl: string
}

export interface PaimindScheduleRunReport {
  readonly contractVersion: '1.0'
  readonly runId: string
  readonly status: 'running' | 'succeeded' | 'failed' | 'needs_attention'
  readonly message?: string
  readonly progress?: number
  readonly action?: PaimindScheduleRunAction
}

/** Developer registration for a standard HTTP action provider. */
export interface PaimindScheduleActionRegistration {
  readonly actionId: string
  readonly nameZh: string
  readonly nameEn: string
  readonly descriptionZh?: string
  readonly descriptionEn?: string
  readonly category: PaimindScheduleActionCategory
  readonly invokeUrl: string
  readonly allowedResultOrigins: readonly string[]
}

export const PAIMIND_SCHEDULE_CAPABILITIES = Object.freeze({
  rules: Object.freeze([...PAIMIND_SCHEDULE_RULE_KINDS]),
  runNow: true as const,
  eventTrigger: false as const,
  cron: false as const,
  fixedInterval: false as const,
  backfill: 'latest-only' as const,
  overlappingRuns: false as const,
  businessParameters: true as const,
})

const SCHEDULE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/
const SCHEDULE_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const SCHEDULE_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const SCHEDULE_RULE_KIND_SET = new Set<string>(PAIMIND_SCHEDULE_RULE_KINDS)
const SCHEDULE_ACTION_CATEGORY_SET = new Set<string>(PAIMIND_SCHEDULE_ACTION_CATEGORIES)
const SCHEDULE_DEFINITION_STATUS_SET = new Set<string>(['enabled', 'paused', 'archived'])
const SCHEDULE_RUN_STATUS_SET = new Set<string>(['queued', 'running', 'succeeded', 'failed', 'needs_attention'])
const SCHEDULE_RUN_TRIGGER_SET = new Set<string>(['schedule', 'manual'])
const SCHEDULE_ACTION_INPUT_MAX_BYTES = 32_768
const SCHEDULE_ACTION_INPUT_MAX_DEPTH = 8
const SCHEDULE_ACTION_INPUT_MAX_KEYS = 128
const SCHEDULE_FORBIDDEN_INPUT_KEY = /(?:authorization|cookie|credential|password|secret|token|connectionstring)/i

function scheduleId(value: string, field: string): string {
  if (!SCHEDULE_ID.test(value)) throw new Error(`invalid schedule ${field}`)
  return value
}

function scheduleText(value: string, field: string, maxLength: number): string {
  const normalized = value.trim()
  if (normalized === '' || normalized.length > maxLength || CONTROL_CHARACTER.test(normalized)) {
    throw new Error(`invalid schedule ${field}`)
  }
  return normalized
}

function scheduleInstant(value: string, field: string): string {
  if (!SCHEDULE_INSTANT.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`invalid schedule ${field}`)
  }
  return value
}

function scheduleUrl(value: string, field: string): string {
  let url: URL
  try { url = new URL(value) } catch { throw new Error(`invalid schedule ${field}`) }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    throw new Error(`schedule ${field} must be credential-free HTTPS`)
  }
  return url.toString()
}

export function definePaimindScheduleRule(candidate: PaimindScheduleRule): Readonly<PaimindScheduleRule> {
  if (!SCHEDULE_RULE_KIND_SET.has(candidate.kind)) throw new Error('invalid schedule rule kind')
  if (candidate.kind === 'once') {
    return Object.freeze({ kind: 'once', at: scheduleInstant(candidate.at, 'once instant') })
  }
  if (!SCHEDULE_TIME.test(candidate.time)) throw new Error('invalid schedule local time')
  if (candidate.kind === 'daily' || candidate.kind === 'weekdays') {
    return Object.freeze({ kind: candidate.kind, time: candidate.time })
  }
  if (candidate.kind === 'weekly') {
    if (!Number.isInteger(candidate.weekday) || candidate.weekday < 1 || candidate.weekday > 7) {
      throw new Error('invalid schedule weekday')
    }
    return Object.freeze({ kind: 'weekly', weekday: candidate.weekday, time: candidate.time })
  }
  if (candidate.kind === 'monthly') {
    if (!Number.isInteger(candidate.dayOfMonth) || candidate.dayOfMonth < 1 || candidate.dayOfMonth > 28) {
      throw new Error('invalid schedule dayOfMonth')
    }
    return Object.freeze({ kind: 'monthly', dayOfMonth: candidate.dayOfMonth, time: candidate.time })
  }
  throw new Error('invalid schedule rule kind')
}

export function definePaimindScheduleActionDescriptor(
  candidate: PaimindScheduleActionDescriptor,
): Readonly<PaimindScheduleActionDescriptor> {
  scheduleId(candidate.actionId, 'actionId')
  scheduleId(candidate.adapterId, 'adapterId')
  scheduleId(candidate.version, 'action version')
  if (!SCHEDULE_ID.test(candidate.source.id)) throw new Error('invalid schedule action source')
  if (!SCHEDULE_ACTION_CATEGORY_SET.has(candidate.category)) throw new Error('invalid schedule action category')
  const descriptionZh = candidate.descriptionZh === undefined
    ? undefined : scheduleText(candidate.descriptionZh, 'descriptionZh', 500)
  const descriptionEn = candidate.descriptionEn === undefined
    ? undefined : scheduleText(candidate.descriptionEn, 'descriptionEn', 500)
  const usageHint = candidate.usageHint === undefined
    ? undefined : scheduleText(candidate.usageHint, 'usageHint', 1_000)
  return Object.freeze({
    ...candidate,
    source: Object.freeze({
      id: candidate.source.id,
      nameZh: scheduleText(candidate.source.nameZh, 'source nameZh', 80),
      nameEn: scheduleText(candidate.source.nameEn, 'source nameEn', 80),
    }),
    nameZh: scheduleText(candidate.nameZh, 'action nameZh', 120),
    nameEn: scheduleText(candidate.nameEn, 'action nameEn', 120),
    ...(descriptionZh === undefined ? {} : { descriptionZh }),
    ...(descriptionEn === undefined ? {} : { descriptionEn }),
    ...(candidate.conversationEnabled === undefined ? {} : { conversationEnabled: candidate.conversationEnabled }),
    ...(usageHint === undefined ? {} : { usageHint }),
  })
}

function scheduleActionInputValue(
  value: unknown,
  depth: number,
  state: { keys: number },
): PaimindScheduleJsonValue {
  if (depth > SCHEDULE_ACTION_INPUT_MAX_DEPTH) throw new Error('schedule actionInput exceeds maximum depth')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('schedule actionInput contains a non-finite number')
    return value
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map(item => scheduleActionInputValue(item, depth + 1, state)))
  }
  if (typeof value !== 'object') throw new Error('schedule actionInput must contain JSON values only')
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('schedule actionInput must contain plain JSON objects only')
  }
  const output: Record<string, PaimindScheduleJsonValue> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    state.keys += 1
    if (state.keys > SCHEDULE_ACTION_INPUT_MAX_KEYS) throw new Error('schedule actionInput has too many fields')
    const normalizedKey = scheduleText(key, 'actionInput key', 120)
    if (Object.hasOwn(output, normalizedKey)) throw new Error(`schedule actionInput contains duplicate field "${normalizedKey}"`)
    if (SCHEDULE_FORBIDDEN_INPUT_KEY.test(normalizedKey)) {
      throw new Error(`schedule actionInput cannot contain sensitive field "${normalizedKey}"`)
    }
    output[normalizedKey] = scheduleActionInputValue(item, depth + 1, state)
  }
  return Object.freeze(output)
}

/** Validate, bound and deep-freeze provider-owned per-definition business input. */
export function definePaimindScheduleActionInput(candidate: unknown): PaimindScheduleActionInput {
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    throw new Error('schedule actionInput must be a JSON object')
  }
  const value = scheduleActionInputValue(candidate, 0, { keys: 0 })
  const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength
  if (bytes > SCHEDULE_ACTION_INPUT_MAX_BYTES) throw new Error('schedule actionInput exceeds maximum size')
  return value as PaimindScheduleActionInput
}

export function definePaimindScheduleRunAction(
  candidate: PaimindScheduleRunAction,
): Readonly<PaimindScheduleRunAction> {
  const label = scheduleText(candidate.label, 'result action label', 80)
  return candidate.kind === 'session'
    ? Object.freeze({ kind: 'session', label, sessionId: scheduleId(candidate.sessionId, 'result sessionId') })
    : Object.freeze({ kind: 'external', label, url: scheduleUrl(candidate.url, 'result action URL') })
}

export function definePaimindScheduleDefinition(
  candidate: PaimindScheduleDefinition,
): Readonly<PaimindScheduleDefinition> {
  scheduleId(candidate.scheduleId, 'scheduleId')
  scheduleId(candidate.actionId, 'actionId')
  scheduleId(candidate.version, 'definition version')
  if (!SCHEDULE_DEFINITION_STATUS_SET.has(candidate.status)) throw new Error('invalid schedule definition status')
  try { new Intl.DateTimeFormat('en', { timeZone: candidate.timeZone }).format() } catch {
    throw new Error('invalid schedule IANA time zone')
  }
  const createdAt = scheduleInstant(candidate.createdAt, 'createdAt')
  const updatedAt = scheduleInstant(candidate.updatedAt, 'updatedAt')
  const nextRunAt = candidate.nextRunAt === undefined ? undefined : scheduleInstant(candidate.nextRunAt, 'nextRunAt')
  const archivedAt = candidate.archivedAt === undefined ? undefined : scheduleInstant(candidate.archivedAt, 'archivedAt')
  const sourceSessionId = candidate.sourceSessionId === undefined
    ? undefined : scheduleText(candidate.sourceSessionId, 'sourceSessionId', 240)
  const actionInput = candidate.actionInput === undefined
    ? undefined : definePaimindScheduleActionInput(candidate.actionInput)
  if (candidate.status === 'archived' && archivedAt === undefined) throw new Error('archived schedule requires archivedAt')
  if (candidate.status === 'archived' && nextRunAt !== undefined) throw new Error('archived schedule cannot have nextRunAt')
  if (candidate.status !== 'archived' && archivedAt !== undefined) throw new Error('active schedule cannot have archivedAt')
  return Object.freeze({
    ...candidate,
    name: scheduleText(candidate.name, 'name', 160),
    rule: definePaimindScheduleRule(candidate.rule),
    createdAt, updatedAt,
    ...(sourceSessionId === undefined ? {} : { sourceSessionId }),
    ...(actionInput === undefined ? {} : { actionInput }),
    ...(nextRunAt === undefined ? {} : { nextRunAt }),
    ...(archivedAt === undefined ? {} : { archivedAt }),
  })
}

export function definePaimindScheduleRun(candidate: PaimindScheduleRun): Readonly<PaimindScheduleRun> {
  for (const [field, value] of [
    ['runId', candidate.runId], ['idempotencyKey', candidate.idempotencyKey],
    ['scheduleId', candidate.scheduleId], ['actionId', candidate.actionId], ['version', candidate.version],
  ] as const) scheduleId(value, field)
  if (!SCHEDULE_RUN_STATUS_SET.has(candidate.status)) throw new Error('invalid schedule run status')
  if (!SCHEDULE_RUN_TRIGGER_SET.has(candidate.trigger)) throw new Error('invalid schedule run trigger')
  if (!Number.isSafeInteger(candidate.attempt) || candidate.attempt < 0) throw new Error('invalid schedule run attempt')
  const scheduledFor = scheduleInstant(candidate.scheduledFor, 'scheduledFor')
  const createdAt = scheduleInstant(candidate.createdAt, 'run createdAt')
  const startedAt = candidate.startedAt === undefined ? undefined : scheduleInstant(candidate.startedAt, 'startedAt')
  const finishedAt = candidate.finishedAt === undefined ? undefined : scheduleInstant(candidate.finishedAt, 'finishedAt')
  const message = candidate.message === undefined ? undefined : scheduleText(candidate.message, 'run message', 4_096)
  const final = candidate.status === 'succeeded' || candidate.status === 'failed' || candidate.status === 'needs_attention'
  if (final && message === undefined) throw new Error('final schedule run requires message')
  if (final && finishedAt === undefined) throw new Error('final schedule run requires finishedAt')
  if (!final && finishedAt !== undefined) throw new Error('non-final schedule run cannot have finishedAt')
  if (candidate.progress !== undefined) {
    if (candidate.status !== 'running') throw new Error('schedule progress is allowed only while running')
    if (!Number.isFinite(candidate.progress) || candidate.progress < 0 || candidate.progress > 100) {
      throw new Error('invalid schedule run progress')
    }
  }
  const action = candidate.action === undefined ? undefined : definePaimindScheduleRunAction(candidate.action)
  return Object.freeze({
    ...candidate, scheduledFor, createdAt,
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(finishedAt === undefined ? {} : { finishedAt }),
    ...(message === undefined ? {} : { message }),
    ...(action === undefined ? {} : { action }),
  })
}

export function definePaimindScheduleTriggerRequest(
  candidate: PaimindScheduleTriggerRequest,
): Readonly<PaimindScheduleTriggerRequest> {
  if (candidate.contractVersion !== '1.0') throw new Error('unsupported schedule contract version')
  for (const [field, value] of [
    ['runId', candidate.runId], ['scheduleId', candidate.scheduleId],
    ['actionId', candidate.actionId], ['idempotencyKey', candidate.idempotencyKey],
  ] as const) scheduleId(value, field)
  const scheduleName = scheduleText(candidate.scheduleName, 'scheduleName', 160)
  if (!SCHEDULE_RUN_TRIGGER_SET.has(candidate.trigger)) throw new Error('invalid schedule run trigger')
  const sourceSessionId = candidate.sourceSessionId === undefined
    ? undefined : scheduleText(candidate.sourceSessionId, 'sourceSessionId', 240)
  const actionInput = candidate.actionInput === undefined
    ? undefined : definePaimindScheduleActionInput(candidate.actionInput)
  return Object.freeze({
    ...candidate,
    scheduleName,
    scheduledFor: scheduleInstant(candidate.scheduledFor, 'scheduledFor'),
    callbackUrl: scheduleUrl(candidate.callbackUrl, 'callback URL'),
    ...(sourceSessionId === undefined ? {} : { sourceSessionId }),
    ...(actionInput === undefined ? {} : { actionInput }),
  })
}

export function definePaimindScheduleRunReport(
  candidate: PaimindScheduleRunReport,
): Readonly<PaimindScheduleRunReport> {
  if (candidate.contractVersion !== '1.0') throw new Error('unsupported schedule contract version')
  scheduleId(candidate.runId, 'runId')
  if (!['running', 'succeeded', 'failed', 'needs_attention'].includes(candidate.status)) {
    throw new Error('invalid schedule run report status')
  }
  const final = candidate.status !== 'running'
  const message = candidate.message === undefined ? undefined : scheduleText(candidate.message, 'run report message', 4_096)
  if (final && message === undefined) throw new Error('final schedule run report requires message')
  if (candidate.progress !== undefined) {
    if (candidate.status !== 'running') throw new Error('schedule progress is allowed only while running')
    if (!Number.isFinite(candidate.progress) || candidate.progress < 0 || candidate.progress > 100) {
      throw new Error('invalid schedule run report progress')
    }
  }
  const action = candidate.action === undefined ? undefined : definePaimindScheduleRunAction(candidate.action)
  return Object.freeze({
    ...candidate,
    ...(message === undefined ? {} : { message }),
    ...(action === undefined ? {} : { action }),
  })
}

/** Product taxonomy used by the PAIMind Extension Center. */
export const PAIMIND_EXTENSION_CATEGORIES = [
  'experience',
  'content-rendering',
  'agents',
  'skills-tools',
  'automation',
  'governance',
  'developer',
] as const

/** Stable category ids; Harness Loader entries deliberately do not own this taxonomy. */
export type PaimindExtensionCategory = typeof PAIMIND_EXTENSION_CATEGORIES[number]

/** Honest product-readiness state kept separate from the Harness technical lifecycle. */
export type PaimindExtensionMaturity =
  | 'available'
  | 'technical-preview'
  | 'reopened'

/** The real surface where an installed capability is used; this is not launcher navigation. */
export type PaimindExtensionSurface =
  | 'shell'
  | 'conversation'
  | 'settings'
  | 'header-button'
  | 'side-card'
  | 'preview'
  | 'headless'

/**
 * Immutable PAIMind product metadata joined to the native Harness Plugin Registry.
 * Runtime identity and enablement remain owned by Harness; this contract adds no
 * second plugin, Agent, Workspace, Job, Schedule, or Deliverable store.
 */
export interface PaimindExtensionDescriptor {
  readonly id: `paimind:${string}`
  readonly packageName: `@paimind/${string}`
  readonly category: PaimindExtensionCategory
  readonly nameZh: string
  readonly nameEn: string
  readonly descriptionZh: string
  readonly descriptionEn: string
  readonly surface: PaimindExtensionSurface
  readonly maturity: PaimindExtensionMaturity
  readonly order?: number
  readonly permissions?: readonly string[]
}

const EXTENSION_CATEGORY_SET = new Set<string>(PAIMIND_EXTENSION_CATEGORIES)
const EXTENSION_MATURITY_SET = new Set<string>([
  'available', 'technical-preview', 'reopened',
])
const EXTENSION_SURFACE_SET = new Set<string>([
  'shell', 'conversation', 'settings', 'header-button', 'side-card', 'preview', 'headless',
])

const requiredText = (value: string, field: string): string => {
  const normalized = value.trim()
  if (normalized.length === 0) throw new Error(`PAIMind extension ${field} must not be empty`)
  return normalized
}

/** Validate, normalize, and deeply freeze one Extension Center contribution. */
export function definePaimindExtension(
  descriptor: PaimindExtensionDescriptor,
): Readonly<PaimindExtensionDescriptor> {
  if (!/^paimind:[a-z0-9][a-z0-9-]*$/.test(descriptor.id)) {
    throw new Error(`invalid PAIMind extension id "${descriptor.id}"`)
  }
  if (!/^@paimind\/[a-z0-9][a-z0-9-]*$/.test(descriptor.packageName)) {
    throw new Error(`invalid PAIMind extension package "${descriptor.packageName}"`)
  }
  if (!EXTENSION_CATEGORY_SET.has(descriptor.category)) {
    throw new Error(`invalid PAIMind extension category "${descriptor.category}"`)
  }
  if (!EXTENSION_MATURITY_SET.has(descriptor.maturity)) {
    throw new Error(`invalid PAIMind extension maturity "${descriptor.maturity}"`)
  }
  if (!EXTENSION_SURFACE_SET.has(descriptor.surface)) {
    throw new Error(`invalid PAIMind extension surface "${descriptor.surface}"`)
  }
  if (descriptor.order !== undefined && !Number.isFinite(descriptor.order)) {
    throw new Error('PAIMind extension order must be finite')
  }
  return Object.freeze({
    ...descriptor,
    nameZh: requiredText(descriptor.nameZh, 'nameZh'),
    nameEn: requiredText(descriptor.nameEn, 'nameEn'),
    descriptionZh: requiredText(descriptor.descriptionZh, 'descriptionZh'),
    descriptionEn: requiredText(descriptor.descriptionEn, 'descriptionEn'),
    permissions: Object.freeze([...(descriptor.permissions ?? [])].map(permission => (
      requiredText(permission, 'permission')
    ))),
  })
}
