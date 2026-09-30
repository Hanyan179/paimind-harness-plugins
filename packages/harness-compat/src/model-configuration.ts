import { serverResponseSchema } from '@deepseek-ai/dsh-host-apiproxy/api/rpc.schema'
import { settingsDescribeValueSchema, settingsUpdateRequestSchema, settingsUpdateValueSchema } from '@deepseek-ai/dsh-host-apiproxy/api/settings.schema'
import { credentialsDescribeValueSchema, credentialsSetRequestSchema, credentialsUnsetRequestSchema } from '@deepseek-ai/dsh-host-apiproxy/api/credentials.schema'
import { createHarnessModelRead, decodeHarnessModelRead, type HarnessModelReadValues, type HarnessModelSettings } from './model-inspection.js'

export interface HarnessModelConfiguration extends HarnessModelSettings {
  writable: boolean
  revision: number | null
  applies: 'live' | 'restart' | null
}
export interface HarnessModelCredentialState { ref: string; configured: boolean; writable: boolean }
export type HarnessModelSelection = NonNullable<HarnessModelSettings['selection']>
export type HarnessModelChangeOutcome<T> = { status: 'applied'; value: T }
  | { status: 'conflict' | 'unconfirmed' }
export interface HarnessModelChange<T> {
  readonly path: string
  /** May contain a write-only credential. Never log or persist this carrier. */
  readonly body: string
  decode(text: string): HarnessModelChangeOutcome<T>
}

const failure = (): never => { throw Error('Native model configuration unavailable') }
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) ? value as Record<string, unknown> : failure()
const label = (value: unknown): string => typeof value === 'string' && value.length > 0 && value.length <= 200
  && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value) ? value : failure()
const revision = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER
  ? value : failure()
const reference = (value: unknown): string => typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,199}$/u.test(value) ? value : failure()
const response = (text: string, rpcId: string) => {
  label(rpcId)
  if (text.length > 2 * 1024 * 1024) return failure()
  const parsed = serverResponseSchema.parse(JSON.parse(text))
  if (parsed.rpcId !== rpcId) return failure()
  return parsed.result
}
function selection(input: unknown): HarnessModelSelection {
  const row = object(input)
  if (Object.keys(row).some(key => !['provider', 'model', 'reasoningEffort'].includes(key))) return failure()
  return { provider: label(row.provider), model: label(row.model),
    ...(row.reasoningEffort === undefined ? {} : { reasoningEffort: label(row.reasoningEffort) }) }
}

/** Configuration preconditions from the original owner, not a write grant.
 * Keep raw schemas, layers, endpoints and credentials out of the projection. */
export function decodeHarnessModelConfiguration(text: string, rpcId: string): HarnessModelConfiguration {
  try {
    const result = response(text, rpcId)
    if (!result.ok) return failure()
    const described = settingsDescribeValueSchema.parse(result.value)
    const settings = decodeHarnessModelRead(text, rpcId, 'settings')
    const row = described.namespaces.find(item => item.ns === 'agent-default-model')
    if (!row) return { ...settings, writable: false, revision: null, applies: null }
    return { ...settings, writable: described.writable, revision: revision(row.revision), applies: row.applies }
  } catch { return failure() }
}

/** Exactly one owner-resolved reference. Presence/writability are observations,
 * not proof that the credential is valid or any model call is authorized. */
export function decodeHarnessModelCredentialState(text: string, rpcId: string, ref: string): HarnessModelCredentialState {
  try {
    reference(ref)
    const result = response(text, rpcId)
    if (!result.ok) return failure()
    const { credentials } = credentialsDescribeValueSchema.parse(result.value)
    if (Object.keys(credentials).length !== 1 || !Object.hasOwn(credentials, ref)) return failure()
    const row = credentials[ref]!
    return { ref, configured: row.configured, writable: row.writable }
  } catch { return failure() }
}

/** Protocol preparation only. The enterprise caller must durably reserve its
 * idempotency key and verify the same admin/session/tenant/member/cell revision
 * immediately before transmission and before confirming a result. This seam
 * neither sends, retries, persists, nor authorizes a request. */
export function prepareHarnessModelSelectionChange(configuration: HarnessModelConfiguration,
  providers: HarnessModelReadValues['providers'], catalog: HarnessModelReadValues['catalog'],
  input: unknown, rpcId: string): HarnessModelChange<HarnessModelSelection & { revision: number; applies: 'live' | 'restart' }> {
  try {
    label(rpcId)
    if (configuration.writable !== true || configuration.revision === null) return failure()
    const expectedRevision = revision(configuration.revision), desired = selection(input)
    if (!providers.some(row => row.provider === desired.provider && row.active)
      || catalog.failedProviders.includes(desired.provider)
      || !catalog.groups.some(group => group.provider === desired.provider && group.models.some(model => model.id === desired.model))) return failure()
    // Patch only these fields; omitting reasoningEffort preserves its current
    // native setting. Never replace the entire namespace or send raw layers.
    const payload = settingsUpdateRequestSchema.parse({ ns: 'agent-default-model', patch: desired, expectedRevision })
    const method = 'settings.update'
    return { path: '/api/' + method, body: JSON.stringify({ type: 'client-request', rpcId, method, payload }), decode(text) {
      try {
        const result = response(text, rpcId)
        if (!result.ok) {
          if (result.error.code === 'settings-conflict' && result.error.details.ns === 'agent-default-model'
            && result.error.details.expected === expectedRevision) return { status: 'conflict' }
          // The owner maps storage exceptions to settings-rejected too. An
          // exception may follow persistence, so only CAS conflict proves no
          // effect. Do not infer rollback from a generic native refusal.
          return { status: 'unconfirmed' }
        }
        const row = settingsUpdateValueSchema.parse(result.value), value = object(row.value), nextRevision = revision(row.revision)
        if (row.ns !== 'agent-default-model' || nextRevision < expectedRevision || value.provider !== desired.provider
          || value.model !== desired.model || desired.reasoningEffort !== undefined && value.reasoningEffort !== desired.reasoningEffort) return { status: 'unconfirmed' }
        return { status: 'applied', value: { provider: desired.provider, model: desired.model,
          ...(value.reasoningEffort === undefined ? {} : { reasoningEffort: label(value.reasoningEffort) }), revision: nextRevision, applies: row.applies } }
      } catch { return { status: 'unconfirmed' } }
    } }
  } catch { return failure() }
}

/** Only the currently selected route's exact, owner-derived named credential
 * may be changed. OAuth/provider-owned auth is not silently replaced. The
 * enterprise journal must handle uncertain writes; credentials have no native
 * CAS revision, so transport failure must never trigger automatic resubmission. */
export function prepareHarnessModelCredentialChange(configuration: HarnessModelConfiguration,
  credential: HarnessModelCredentialState, input: { action: 'set'; value: string } | { action: 'unset' },
  rpcId: string): HarnessModelChange<{ ref: string }> {
  try {
    label(rpcId)
    const ref = reference(configuration.credentialRef)
    if (credential.ref !== ref || credential.writable !== true) return failure()
    const row = object(input)
    if (row.action !== 'set' && row.action !== 'unset'
      || Object.keys(row).some(key => !['action', ...(row.action === 'set' ? ['value'] : [])].includes(key))) return failure()
    const setting = row.action === 'set'
    if (setting && (typeof row.value !== 'string' || row.value.length > 16_384 || row.value.length === 0 || /[\u0000\r\n]/u.test(row.value))) return failure()
    const payload = setting ? credentialsSetRequestSchema.parse({ ref, value: row.value }) : credentialsUnsetRequestSchema.parse({ ref })
    const method = setting ? 'credentials.set' : 'credentials.unset'
    return { path: '/api/' + method, body: JSON.stringify({ type: 'client-request', rpcId, method, payload }), decode(text) {
      try {
        const result = response(text, rpcId)
        // credential-rejected also includes storage exceptions; it is not a
        // durable no-effect receipt and cannot authorize an automatic retry.
        if (!result.ok) return { status: 'unconfirmed' }
        if (Object.keys(object(result.value)).length !== 0) return { status: 'unconfirmed' }
        return { status: 'applied', value: { ref } }
      } catch { return { status: 'unconfirmed' } }
    } }
  } catch { return failure() }
}

/** Uses the same original readonly carrier as model inspection. */
export const createHarnessModelConfigurationRead = (rpcId: string) => createHarnessModelRead('settings', rpcId)
