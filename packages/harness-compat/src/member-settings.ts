import { clientRequestSchema, serverResponseSchema } from '@deepseek-ai/dsh-host-apiproxy/api/rpc.schema'
import { settingsDescribeValueSchema } from '@deepseek-ai/dsh-host-apiproxy/api/settings.schema'

const preferences = { locale: ['zh', 'en'], 'ui-theme': ['light', 'dark', 'system'] } as const
type Namespace = keyof typeof preferences
const fail = (): never => { throw Error('Unsupported native display settings') }
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object'
  && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype ? value as Record<string, unknown> : fail()
const keys = (value: Record<string, unknown>, expected: string[]) => {
  if (Object.keys(value).sort().join(',') !== expected.toSorted().join(',')) fail()
}
const integer = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fail()

/** Validate the selected native Schemastery graph, not arbitrary schema
 * metadata. UIDs vary with registration order; the complete reachable graph
 * must still be exactly the original one-field enum, with no orphan nodes. */
function displaySchema(value: unknown, ns: Namespace): unknown {
  const schema = record(value); keys(schema, ['uid', 'refs'])
  const refs = record(schema.refs), used = new Set<string>()
  const node = (id: unknown) => {
    const key = String(integer(id))
    if (used.has(key) || !Object.hasOwn(refs, key)) return fail()
    used.add(key); return record(refs[key])
  }
  const root = node(schema.uid); keys(root, ['type', 'meta', 'dict'])
  if (root.type !== 'object') fail()
  const rootMeta = record(root.meta); keys(rootMeta, ['default']); keys(record(rootMeta.default), [])
  const fields = record(root.dict); keys(fields, ['preference'])
  const choice = node(fields.preference); keys(choice, ['type', 'meta', 'list'])
  if (choice.type !== 'union' || !Array.isArray(choice.list) || choice.list.length !== preferences[ns].length) fail()
  const meta = record(choice.meta)
  if (ns === 'locale') { keys(meta, ['required']); if (meta.required !== false) fail() }
  else { keys(meta, ['default']); if (meta.default !== 'system') fail() }
  for (const [index, id] of (choice.list as unknown[]).entries()) {
    const constant = node(id); keys(constant, ['type', 'meta', 'value'])
    if (constant.type !== 'const' || constant.value !== preferences[ns][index]) fail()
    const detail = record(constant.meta); keys(detail, ['required']); if (detail.required !== true) fail()
  }
  if (Object.keys(refs).length !== used.size) fail()
  return value
}

export interface HarnessMemberSettingsRead {
  /** Current native values only. No base/user layers, credentials, arbitrary
   * schemas, write capability, document access or new persistence. */
  projectResponse(body: Uint8Array): Uint8Array
}

/** Format adapter only. The caller must enforce current member identity and
 * private-cell binding before the read AND before releasing projected bytes. */
export function prepareHarnessMemberSettingsRead(method: string, target: string, contentType: string | undefined,
  body: Uint8Array): HarnessMemberSettingsRead | undefined {
  if (new URL(target, 'http://native.invalid').pathname !== '/api/settings.describe') return undefined
  if (target !== '/api/settings.describe' || method !== 'POST'
    || contentType?.split(';')[0]?.trim().toLowerCase() !== 'application/json' || body.byteLength > 4096) fail()
  const decode = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  const request = clientRequestSchema.parse(decode(body))
  if (request.method !== 'settings.describe') fail()
  keys(record(request.payload), [])
  return Object.freeze({ projectResponse(bytes: Uint8Array): Uint8Array {
    if (!bytes.byteLength || bytes.byteLength > 2 * 1024 * 1024) fail()
    const response = serverResponseSchema.parse(decode(bytes))
    if (response.rpcId !== request.rpcId || !response.result.ok) return fail()
    const description = settingsDescribeValueSchema.parse(response.result.value)
    if (description.namespaces.length > 512 || new Set(description.namespaces.map(row => row.ns)).size !== description.namespaces.length) fail()
    const namespaces = description.namespaces.filter(row => Object.hasOwn(preferences, row.ns)).map(row => {
      const ns = row.ns as Namespace, value = record(row.value)
      if (Object.keys(value).some(key => key !== 'preference') || row.secrets.length !== 0
        || row.applies !== 'live') fail()
      if (value.preference !== undefined && !(preferences[ns] as readonly unknown[]).includes(value.preference)) fail()
      if (ns === 'ui-theme' && value.preference === undefined) fail()
      return { ns, schema: displaySchema(row.schema, ns), value, applies: row.applies,
        secrets: [], revision: integer(row.revision) }
    })
    return Buffer.from(JSON.stringify({ type: 'server-response', rpcId: request.rpcId,
      result: { ok: true, value: { writable: false, hasDocument: false, namespaces } } }))
  } })
}
