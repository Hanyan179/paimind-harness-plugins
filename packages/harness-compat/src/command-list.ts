import { clientRequestSchema, serverResponseSchema } from '@deepseek-ai/dsh-host-apiproxy/api/rpc.schema'
const fail = (): never => { throw Error('Unsupported native command-list carrier') }
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object'
  && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype ? value as Record<string, unknown> : fail()
const keys = (value: Record<string, unknown>, required: string[], optional: string[] = []) => {
  if (required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) fail()
}
const decode = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
const text = (value: unknown, max: number): string => typeof value === 'string' && value.length <= max && !value.includes('\0') ? value : fail()

export interface HarnessCommandListRequest {
  readonly sessionId: string
  /** Validate the original descriptors and correlation without constructing a
   * shadow catalog, changing scopes or turning an owner refusal into success. */
  assertResponse(body: Uint8Array): void
}

/** Native list is agent-addressed and its original resolver can cold-resume
 * that Agent. This format adapter is NOT authorization or a pure-history read:
 * managed callers must prove current preset eligibility before forwarding. */
export function prepareHarnessCommandListRequest(method: string, target: string, contentType: string | undefined,
  body: Uint8Array): HarnessCommandListRequest | undefined {
  if (new URL(target, 'http://native.invalid').pathname !== '/api/commands/list') return undefined
  if (target !== '/api/commands/list' || method !== 'POST' || !body.byteLength || body.byteLength > 4096
    || contentType?.split(';')[0]?.trim().toLowerCase() !== 'application/json') fail()
  const rawRequest = record(decode(body)); keys(rawRequest, ['type', 'rpcId', 'method', 'payload'])
  const request = clientRequestSchema.parse(rawRequest)
  if (request.method !== 'commands/list') fail()
  const payload = record(request.payload); keys(payload, ['args'])
  const args = record(payload.args); keys(args, ['agentId'])
  const sessionId = text(args.agentId, 200)
  if (!sessionId || sessionId.trim() !== sessionId || /[\u0000-\u001f\u007f]/u.test(sessionId)) fail()
  return Object.freeze({ sessionId, assertResponse(bytes: Uint8Array): void {
    if (!bytes.byteLength || bytes.byteLength > 256 * 1024) fail()
    const raw = record(decode(bytes)); keys(raw, ['type', 'rpcId', 'result'])
    const response = serverResponseSchema.parse(raw)
    if (response.rpcId !== request.rpcId) fail()
    const result = record(raw.result); keys(result, ['ok', response.result.ok ? 'value' : 'error'])
    if (!response.result.ok) return
    const descriptors = response.result.value
    if (!Array.isArray(descriptors) || descriptors.length > 512) fail()
    const names = new Set<string>()
    for (const item of descriptors as unknown[]) {
      const row = record(item); keys(row, ['name', 'description'], ['input'])
      const name = text(row.name, 200)
      if (!name || names.has(name)) fail()
      names.add(name); text(row.description, 4096)
      if (row.input !== undefined) {
        const input = record(row.input); keys(input, ['hint'], ['images']); text(input.hint, 4096)
        if (input.images !== undefined && typeof input.images !== 'boolean') fail()
      }
    }
  } })
}
