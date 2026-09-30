import { createHash } from 'node:crypto'
import { clientRequestSchema, serverResponseSchema } from '@deepseek-ai/dsh-host-apiproxy/api/rpc.schema'

// Private gateway-to-native metadata, not browser identity or a new RPC. The
// gateway never forwards caller-supplied headers with either name.
export const COMMAND_ORIGIN_HEADER = 'x-paimind-command-origin'
export const COMMAND_BINDING_HEADER = 'x-paimind-command-binding'
const fail = (): never => { throw Error('Unsupported native export command carrier') }
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object'
  && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype ? value as Record<string, unknown> : fail()
const keys = (value: Record<string, unknown>, names: string[]) => {
  if (Object.keys(value).sort().join(',') !== [...names].sort().join(',')) fail()
}
const identity = (value: unknown): string => typeof value === 'string' && value.length > 0 && value.length <= 200
  && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value) ? value : fail()
export const isNativeExportLine = (line: unknown): line is string => typeof line === 'string'
  && /^\/export(?=$|[\t\n\r ])/u.test(line)
export function assertCommandOrigin(source: string): void {
  if (typeof source !== 'string' || source.length > 1536 || !/^paimind-origin-v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u.test(source)) fail()
}
/** Bind the exact native call inside one authenticated private carrier. This
 * digest is not a signature or authorization; checkOrigins remains mandatory. */
export function commandInvocationBinding(source: string, sessionId: string, line: string): string {
  assertCommandOrigin(source); identity(sessionId)
  if (!isNativeExportLine(line) || line.length > 4096 || line.includes('\0')) fail()
  return createHash('sha256').update(JSON.stringify([source, sessionId, line, []])).digest('hex')
}
export interface HarnessExportCommandRequest {
  readonly nativeSessionId: string
  readonly clientRpcId: string
  readonly requiresPresetEligibility: true
  stamp(source: string): Uint8Array
  privateHeaders(source: string): Readonly<Record<string, string>>
  restoreResponse(bytes: Uint8Array, source: string): Uint8Array
}

/** First executable command slice: the original Web export owner. This does
 * not enable model/history/permission commands, change their handlers, or make
 * the command's request-text receipt proof that a download completed. */
export function prepareHarnessExportCommandRequest(method: string, target: string, contentType: string | undefined,
  body: Uint8Array): HarnessExportCommandRequest | undefined {
  if (new URL(target, 'http://native.invalid').pathname !== '/api/commands/execute') return undefined
  if (target !== '/api/commands/execute' || method !== 'POST' || !body.byteLength || body.byteLength > 16384
    || contentType?.split(';')[0]?.trim().toLowerCase() !== 'application/json') fail()
  const raw = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)))
  // Other commands retain their separately reviewed policy. Never interpret a
  // prefix such as /export-all as this command or normalize arbitrary input.
  const payload = record(raw.payload), args = record(payload.args)
  if (!isNativeExportLine(args.line)) return undefined
  if (args.line.length > 4096 || args.line.includes('\0')) fail()
  keys(raw, ['type', 'rpcId', 'method', 'payload']); keys(payload, ['args']); keys(args, ['agentId', 'line', 'images'])
  const request = clientRequestSchema.parse(raw)
  if (request.method !== 'commands/execute' || !Array.isArray(args.images) || args.images.length !== 0) fail()
  const nativeSessionId = identity(args.agentId), clientRpcId = identity(request.rpcId), line = args.line
  return Object.freeze({ nativeSessionId, clientRpcId, requiresPresetEligibility: true as const,
    stamp(source: string) { assertCommandOrigin(source); return Buffer.from(JSON.stringify({ ...raw, rpcId: source })) },
    privateHeaders(source: string) { return Object.freeze({ [COMMAND_ORIGIN_HEADER]: source,
      [COMMAND_BINDING_HEADER]: commandInvocationBinding(source, nativeSessionId, line) }) },
    restoreResponse(bytes: Uint8Array, source: string) {
      assertCommandOrigin(source)
      if (!bytes.byteLength || bytes.byteLength > 256 * 1024) fail()
      const raw = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
      keys(raw, ['type', 'rpcId', 'result'])
      const response = serverResponseSchema.parse(raw)
      if (response.rpcId !== source) fail()
      keys(record(raw.result), ['ok', response.result.ok ? 'value' : 'error'])
      if (response.result.ok) {
        const value = record(response.result.value); keys(value, ['commandId', 'result'])
        identity(value.commandId)
        const result = record(value.result)
        if (!['success', 'error'].includes(String(result.kind)) || typeof result.text !== 'string' || result.text.length > 8192) fail()
        keys(result, ['kind', 'text'])
      }
      return Buffer.from(JSON.stringify({ ...raw, rpcId: clientRpcId }))
    },
  })
}
