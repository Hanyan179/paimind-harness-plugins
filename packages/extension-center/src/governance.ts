import { createHash } from 'node:crypto'
import { PAIMIND_FEATURE_PACKS, type PaimindFeatureToggleMutationRequest } from './feature-packs.js'

export const FEATURE_COMMAND_SCHEMA = 'paimind.feature-command/v1' as const
export const FEATURE_CATALOG_DIGEST = digest(PAIMIND_FEATURE_PACKS)
export const FEATURE_RECONCILED_PACK_IDS: readonly string[] = Object.freeze(PAIMIND_FEATURE_PACKS.map(pack => pack.id).sort())
const toggleIds = new Set(PAIMIND_FEATURE_PACKS.flatMap(pack => [pack.id, ...pack.capabilities.map(capability => capability.id)]))
const hashPattern = /^sha256:[a-f0-9]{64}$/u
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u
export function digest(value: unknown): string { return 'sha256:' + createHash('sha256').update(JSON.stringify(value)).digest('hex') }
function record(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw Error('Invalid governed Feature Pack command')
}
export function readFeatureSelection(value: unknown): Readonly<PaimindFeatureToggleMutationRequest> {
  record(value, ['id', 'enabled', 'expectedRevision'])
  if (typeof value.id !== 'string' || !toggleIds.has(value.id as never) || typeof value.enabled !== 'boolean'
    || !Number.isSafeInteger(value.expectedRevision) || Number(value.expectedRevision) < 0) throw Error('Invalid governed Feature Pack selection')
  return Object.freeze({ id: value.id, enabled: value.enabled, expectedRevision: Number(value.expectedRevision) })
}
export interface PaimindFeatureChangePlan {
  readonly schema: typeof FEATURE_COMMAND_SCHEMA
  readonly catalogDigest: string
  readonly selection: Readonly<PaimindFeatureToggleMutationRequest>
  readonly before: string
  readonly after: string
  readonly reconciledPackIds: readonly string[]
  readonly planDigest: string
}
export function featureChangePlan(selection: Readonly<PaimindFeatureToggleMutationRequest>, before: string, after: string): PaimindFeatureChangePlan {
  if (before.length > 8192 || after.length > 8192) throw Error('Feature Pack settings exceed the bounded command size')
  const body = { schema: FEATURE_COMMAND_SCHEMA, catalogDigest: FEATURE_CATALOG_DIGEST,
    selection: readFeatureSelection(selection), before, after, reconciledPackIds: FEATURE_RECONCILED_PACK_IDS }
  return Object.freeze({ ...body, planDigest: digest(body) })
}
/** Detached strict projection for the real control-plane consumer. Object key
 * order is not an identity boundary (PostgreSQL JSONB reorders object keys). */
export function readFeatureChangePlan(value: unknown): PaimindFeatureChangePlan {
  record(value, ['schema', 'catalogDigest', 'selection', 'before', 'after', 'reconciledPackIds', 'planDigest'])
  if (typeof value.before !== 'string' || typeof value.after !== 'string') throw Error('Invalid Feature Pack command plan')
  const expected = featureChangePlan(readFeatureSelection(value.selection), value.before, value.after)
  if (value.schema !== expected.schema || value.catalogDigest !== expected.catalogDigest || value.planDigest !== expected.planDigest
    || JSON.stringify(value.reconciledPackIds) !== JSON.stringify(expected.reconciledPackIds)) throw Error('Feature Pack plan does not match its owner')
  return expected
}
export interface PaimindGovernedFeatureCommand {
  readonly commandId: string
  readonly requestDigest: string
  readonly planDigest: string
  readonly selection: Readonly<PaimindFeatureToggleMutationRequest>
  /** Current control-plane approval, supplied only by a trusted internal caller. */
  readonly approvedPackIds: readonly string[]
}
export function readGovernedFeatureCommand(value: unknown): PaimindGovernedFeatureCommand {
  record(value, ['commandId', 'requestDigest', 'planDigest', 'selection', 'approvedPackIds'])
  if (typeof value.commandId !== 'string' || !uuidPattern.test(value.commandId)
    || typeof value.requestDigest !== 'string' || !hashPattern.test(value.requestDigest)
    || typeof value.planDigest !== 'string' || !hashPattern.test(value.planDigest)
    || !Array.isArray(value.approvedPackIds) || value.approvedPackIds.length > FEATURE_RECONCILED_PACK_IDS.length
    || value.approvedPackIds.some(id => typeof id !== 'string' || !FEATURE_RECONCILED_PACK_IDS.includes(id))
    || new Set(value.approvedPackIds).size !== value.approvedPackIds.length) throw Error('Invalid governed Feature Pack command')
  return Object.freeze({ commandId: value.commandId, requestDigest: value.requestDigest, planDigest: value.planDigest,
    selection: readFeatureSelection(value.selection), approvedPackIds: Object.freeze([...value.approvedPackIds].sort()) as readonly string[] })
}
export interface PaimindFeatureCommandJournal {
  readonly schema: typeof FEATURE_COMMAND_SCHEMA
  readonly commandId: string
  readonly requestDigest: string
  readonly plan: PaimindFeatureChangePlan
  readonly phase: 'applying' | 'applied' | 'rolling-back' | 'rolled-back'
}
export function readFeatureJournal(value: unknown): PaimindFeatureCommandJournal | undefined {
  if (value === undefined || value === '') return undefined
  if (typeof value !== 'string' || value.length > 40000) throw Error('Invalid Feature Pack command journal')
  const journal: unknown = JSON.parse(value)
  record(journal, ['schema', 'commandId', 'requestDigest', 'plan', 'phase'])
  if (journal.schema !== FEATURE_COMMAND_SCHEMA || typeof journal.commandId !== 'string' || !uuidPattern.test(journal.commandId)
    || typeof journal.requestDigest !== 'string' || !hashPattern.test(journal.requestDigest)
    || !['applying', 'applied', 'rolling-back', 'rolled-back'].includes(String(journal.phase))) throw Error('Invalid Feature Pack command journal')
  const plan = journal.plan
  record(plan, ['schema', 'catalogDigest', 'selection', 'before', 'after', 'reconciledPackIds', 'planDigest'])
  if (typeof plan.before !== 'string' || typeof plan.after !== 'string') throw Error('Invalid Feature Pack command plan')
  const expected = featureChangePlan(readFeatureSelection(plan.selection), plan.before, plan.after)
  if (JSON.stringify(plan) !== JSON.stringify(expected)) throw Error('Feature Pack command plan no longer matches its owner')
  return Object.freeze({ schema: FEATURE_COMMAND_SCHEMA, commandId: journal.commandId, requestDigest: journal.requestDigest,
    plan: expected, phase: journal.phase as PaimindFeatureCommandJournal['phase'] })
}
export function requireFeatureApproval(command: PaimindGovernedFeatureCommand): void {
  if (FEATURE_RECONCILED_PACK_IDS.some(id => !command.approvedPackIds.includes(id))) {
    throw Error('Approval must cover every Product Pack reconciled by this owner, including rollback')
  }
}
