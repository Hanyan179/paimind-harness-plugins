import { createHash, randomUUID } from 'node:crypto'
import { request } from 'node:http'
import { createHarnessSessionInspection, decodeHarnessSessionInspection, type HarnessSessionInspectionSelection } from '@paimind/harness-compat/gateway-transport'
import { EnterpriseError, invalid, record, text, uuid } from './errors.js'
import type { Identity } from './identity.js'
import type { RuntimeBindings, PrivateRuntimeCell } from './runtime-bindings.js'
import type { CellTransport } from './cell-transport.js'
import { retainCellTransports, selectCellTransport } from './cell-transport-directory.js'

function selection(input: unknown): HarnessSessionInspectionSelection {
  if (!input || typeof input !== 'object') return invalid()
  if ('kind' in input && input.kind === 'sessions') { record(input, ['kind']); return { kind: 'sessions' } }
  const row = record(input, ['kind', 'sessionId', 'beforeSeq'])
  if (row.kind !== 'history' || row.beforeSeq !== null && (!Number.isSafeInteger(row.beforeSeq) || Number(row.beforeSeq) <= 0)) return invalid()
  return { kind: 'history', sessionId: text(row.sessionId, 1, 200), ...(row.beforeSeq === null ? {} : { beforeSeq: Number(row.beforeSeq) }) }
}
const unavailable = () => new EnterpriseError(502, 'member-content-unavailable', '成员会话暂时无法读取；没有返回任何内容', true)

/** Reason-gated, bounded original-owner reads. No transcript storage, member
 * impersonation, arbitrary method/path, or reusable cross-user grant. */
export class MemberContent {
  private readonly active = new Set<AbortController>()
  private readonly pending = new Map<string, number>()
  private closed = false
  private readonly transports: ReadonlyMap<string, CellTransport>
  constructor(private readonly identity: Identity, private readonly bindings: RuntimeBindings, transports: ReadonlyMap<string, CellTransport>) {
    this.transports = retainCellTransports(transports)
  }
  close(): void { this.closed = true; for (const abort of this.active) abort.abort(); this.active.clear() }
  async read(token: string | undefined, input: unknown, requestId: string, cancellation: AbortSignal) {
    const row = record(input, ['memberId', 'reason', 'confirmed', 'selection'])
    if (row.confirmed !== true) return invalid('请确认只读查看及审计提示')
    const memberId = uuid(row.memberId), reason = text(row.reason, 3, 500), selected = selection(row.selection)
    const key = createHash('sha256').update(token ?? '').digest('hex')
    if (this.closed || this.active.size >= 8 || (this.pending.get(key) ?? 0) >= 2) {
      throw new EnterpriseError(503, 'member-content-busy', '成员内容读取已达上限，请稍后重试', true)
    }
    const lifetime = new AbortController(), signal = AbortSignal.any([lifetime.signal, cancellation, AbortSignal.timeout(15_000)])
    this.active.add(lifetime); this.pending.set(key, (this.pending.get(key) ?? 0) + 1)
    try {
      signal.throwIfAborted()
      return await this.identity.inspectMemberContent(token, memberId, reason, JSON.stringify(selected), requestId, signal,
        (db, member) => this.bindings.selectInspectedMember(db, member), async (cell, verify) => {
          await verify(); signal.throwIfAborted()
          const data = await this.readNative(cell, selected, signal)
          await verify(); signal.throwIfAborted(); return data
        })
    } finally {
      this.active.delete(lifetime)
      const remaining = (this.pending.get(key) ?? 1) - 1
      if (remaining) this.pending.set(key, remaining); else this.pending.delete(key)
    }
  }
  private async readNative(cell: PrivateRuntimeCell, selected: HarnessSessionInspectionSelection, signal: AbortSignal) {
    const transport = selectCellTransport(this.transports, cell)
    if (!transport || transport.ingressOrigin !== cell.origin) throw unavailable()
    const target = new URL(transport.nativeOrigin), rpcId = randomUUID(), wire = createHarnessSessionInspection(selected, rpcId)
    return new Promise<ReturnType<typeof decodeHarnessSessionInspection>>((resolve, reject) => {
      const outbound = request({ hostname: target.hostname, port: target.port, path: wire.path, method: 'POST', agent: transport, signal,
        headers: { host: target.host, origin: target.origin, 'content-type': 'application/json', 'content-length': Buffer.byteLength(wire.body), 'accept-encoding': 'identity' } }, async incoming => {
        try {
          if (incoming.statusCode !== 200 || incoming.headers['content-type']?.split(';')[0]?.trim() !== 'application/json'
            || incoming.headers['content-encoding'] && incoming.headers['content-encoding'] !== 'identity') throw unavailable()
          const chunks: Buffer[] = []; let size = 0
          for await (const chunk of incoming) {
            signal.throwIfAborted(); const bytes = Buffer.from(chunk); size += bytes.length
            if (size > 2 * 1024 * 1024) throw new EnterpriseError(413, 'member-content-too-large', '本页内容超过安全读取上限，未返回不完整内容')
            chunks.push(bytes)
          }
          signal.throwIfAborted(); resolve(decodeHarnessSessionInspection(Buffer.concat(chunks).toString('utf8'), rpcId, selected))
        } catch (error) { incoming.destroy(); outbound.destroy(); reject(error instanceof EnterpriseError ? error : unavailable()) }
      })
      outbound.once('error', () => reject(unavailable()))
      outbound.setTimeout(8_000, () => outbound.destroy(unavailable()))
      outbound.end(wire.body)
    })
  }
}
