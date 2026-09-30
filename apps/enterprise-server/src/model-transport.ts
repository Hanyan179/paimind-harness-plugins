import { request } from 'node:http'
import { EnterpriseError } from './errors.js'
import type { PrivateRuntimeCell } from './runtime-bindings.js'
import type { CellTransport } from './cell-transport.js'
import { selectCellTransport } from './cell-transport-directory.js'

/** Internal, bounded transport for compat-created model carriers only. Neither
 * callers nor native failures may supply a URL, forwarded cookie or raw error. */
export async function requestNativeModel(transports: ReadonlyMap<string, CellTransport>, cell: PrivateRuntimeCell,
  wire: { path: string; body: string }, signal: AbortSignal): Promise<string> {
  return requestNativeConfiguration(transports, cell, wire, signal,
    () => new EnterpriseError(502, 'model-state-unavailable', '原生模型操作结果无法确认；请查看操作记录，不要重复提交', true))
}

/** Shared bounded private transport; only trusted compat-created carriers
 * reach this seam. Browser inputs never choose the target, path or headers. */
export async function requestNativeConfiguration(transports: ReadonlyMap<string, CellTransport>, cell: PrivateRuntimeCell,
  wire: { path: string; body: string }, signal: AbortSignal, unavailable: () => EnterpriseError): Promise<string> {
  signal.throwIfAborted()
  const transport = selectCellTransport(transports, cell)
  if (!transport || transport.ingressOrigin !== cell.origin) throw unavailable()
  const target = new URL(transport.nativeOrigin)
  return new Promise((resolve, reject) => {
    const outbound = request({ hostname: target.hostname, port: target.port, path: wire.path, method: 'POST', agent: transport, signal,
      headers: { host: target.host, origin: target.origin, 'content-type': 'application/json', 'content-length': Buffer.byteLength(wire.body), 'accept-encoding': 'identity' } }, async incoming => {
      try {
        if (incoming.statusCode !== 200 || incoming.headers['content-type']?.split(';')[0]?.trim() !== 'application/json'
          || incoming.headers['content-encoding'] && incoming.headers['content-encoding'] !== 'identity') throw unavailable()
        const chunks: Buffer[] = []; let size = 0
        for await (const chunk of incoming) {
          signal.throwIfAborted(); const bytes = Buffer.from(chunk); size += bytes.length
          if (size > 2 * 1024 * 1024) throw unavailable()
          chunks.push(bytes)
        }
        signal.throwIfAborted(); resolve(Buffer.concat(chunks).toString('utf8'))
      } catch { incoming.destroy(); outbound.destroy(); reject(unavailable()) }
    })
    outbound.once('error', () => reject(unavailable()))
    outbound.setTimeout(8_000, () => outbound.destroy(unavailable()))
    outbound.end(wire.body)
  })
}
