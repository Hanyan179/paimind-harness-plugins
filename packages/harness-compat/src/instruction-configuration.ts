import { serverResponseSchema } from '@deepseek-ai/dsh-host-apiproxy/api/rpc.schema'
import { settingsDescribeValueSchema, settingsUpdateRequestSchema, settingsUpdateValueSchema } from '@deepseek-ai/dsh-host-apiproxy/api/settings.schema'

const namespace = 'paimind-enterprise-instructions'
const fail = (): never => { throw Error('Native enterprise instructions unavailable') }
const revision = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value)
  && value >= 0 && value < Number.MAX_SAFE_INTEGER ? value : fail()
const correlation = (value: string) => { if (!value || value.length > 200 || /[\u0000-\u001f\u007f]/u.test(value)) fail() }
export interface HarnessInstructionValue { enabled: boolean; instructions: string }
export interface HarnessInstructionConfiguration extends HarnessInstructionValue { revision: number; writable: boolean; applies: 'live' }
export function normalizeHarnessInstructions(value: unknown): HarnessInstructionValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail()
  const row = value as Record<string, unknown>
  if (Object.keys(row).sort().join(',') !== 'enabled,instructions' || typeof row.enabled !== 'boolean'
    || typeof row.instructions !== 'string' || row.instructions.length > 8_000) return fail()
  return { enabled: row.enabled, instructions: row.instructions }
}
const response = (text: string, rpcId: string) => {
  correlation(rpcId)
  if (Buffer.byteLength(text) > 2 * 1024 * 1024) return fail()
  const row = serverResponseSchema.parse(JSON.parse(text))
  if (row.rpcId !== rpcId) return fail()
  return row.result
}
export function createHarnessInstructionRead(rpcId: string) {
  correlation(rpcId)
  return { path: '/api/settings.describe', body: JSON.stringify({ type: 'client-request', rpcId, method: 'settings.describe', payload: {} }) }
}
/** Project the exact original owner only. Never return raw schema, other
 * namespaces, base/user layers, private paths or secret descriptors. */
export function decodeHarnessInstructionConfiguration(text: string, rpcId: string): HarnessInstructionConfiguration {
  try {
    const result = response(text, rpcId); if (!result.ok) return fail()
    const state = settingsDescribeValueSchema.parse(result.value)
    if (state.namespaces.length > 512 || new Set(state.namespaces.map(row => row.ns)).size !== state.namespaces.length) return fail()
    const row = state.namespaces.find(row => row.ns === namespace)
    if (!row || row.secrets.length || row.applies !== 'live') return fail()
    return { ...normalizeHarnessInstructions(row.value), revision: revision(row.revision), writable: state.writable, applies: 'live' }
  } catch { return fail() }
}
/** A fixed original-owner carrier, not an authorization or transport. Native
 * revisions are process-local: the caller must also pin the cell incarnation,
 * reserve one durable sender, and revalidate current authority and readback. */
export function prepareHarnessInstructionChange(before: HarnessInstructionConfiguration, input: unknown, rpcId: string) {
  correlation(rpcId)
  if (before.writable !== true || before.applies !== 'live') return fail()
  const expectedRevision = revision(before.revision), desired = normalizeHarnessInstructions(input)
  const payload = settingsUpdateRequestSchema.parse({ ns: namespace, patch: desired, expectedRevision })
  return { path: '/api/settings.update', body: JSON.stringify({ type: 'client-request', rpcId, method: 'settings.update', payload }),
    decode(text: string): { status: 'applied'; value: HarnessInstructionConfiguration } | { status: 'conflict' | 'unconfirmed' } {
      try {
        const result = response(text, rpcId)
        if (!result.ok) return result.error.code === 'settings-conflict' && result.error.details.ns === namespace
          && result.error.details.expected === expectedRevision ? { status: 'conflict' } : { status: 'unconfirmed' }
        const row = settingsUpdateValueSchema.parse(result.value), value = normalizeHarnessInstructions(row.value)
        if (row.ns !== namespace || row.applies !== 'live' || revision(row.revision) < expectedRevision
          || value.enabled !== desired.enabled || value.instructions !== desired.instructions) return { status: 'unconfirmed' }
        return { status: 'applied', value: { ...value, revision: row.revision, applies: 'live', writable: true } }
      } catch { return { status: 'unconfirmed' } }
    } }
}
