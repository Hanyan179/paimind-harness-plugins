import { createHash } from 'node:crypto'
import { validateConnectorInventory, type NativeConnectorInventory } from '../../../deploy/enterprise/worker/runtime/native-control.mjs'
import { EnterpriseError, invalid, record, text, uuid } from './errors.js'
import type { Identity } from './identity.js'
import type { RuntimeBindings } from './runtime-bindings.js'
import type { CellTransport } from './cell-transport.js'
import { retainCellTransports, selectCellTransport } from './cell-transport-directory.js'

/** Fresh native-owner observation, not a saved connector registry, configuration
 * writer, tool grant or health probe. The exact launcher is operator-pinned. */
export class ConnectorInspection {
  private readonly active = new Set<AbortController>()
  private readonly pending = new Map<string, number>()
  private readonly transports: ReadonlyMap<string, CellTransport>
  private closed = false
  constructor(private readonly identity: Identity, private readonly bindings: RuntimeBindings, transports: ReadonlyMap<string, CellTransport>) {
    this.transports = retainCellTransports(transports)
  }
  close(): void { this.closed = true; for (const abort of this.active) abort.abort(); this.active.clear() }
  async read(token: string | undefined, input: unknown, requestId: string, cancellation: AbortSignal) {
    const row = record(input, ['memberId', 'reason', 'confirmed'])
    if (row.confirmed !== true) return invalid('请确认连接器状态读取及审计提示')
    const memberId = uuid(row.memberId), reason = text(row.reason, 3, 500)
    const key = createHash('sha256').update(token ?? '').digest('hex')
    if (this.closed || this.active.size >= 8 || (this.pending.get(key) ?? 0) >= 2) {
      throw new EnterpriseError(503, 'connector-state-busy', '连接器状态读取已达上限，请稍后重试', true)
    }
    const lifetime = new AbortController(), signal = AbortSignal.any([lifetime.signal, cancellation, AbortSignal.timeout(15_000)])
    this.active.add(lifetime); this.pending.set(key, (this.pending.get(key) ?? 0) + 1)
    try {
      signal.throwIfAborted()
      return await this.identity.inspectMemberConnectors(token, memberId, reason, requestId, signal,
        (db, member) => this.bindings.selectManagedAccount(db, member), async (cell, verify) => {
          await verify(); signal.throwIfAborted()
          const transport = selectCellTransport(this.transports, cell)
          const unavailable = () => new EnterpriseError(502, 'connector-state-unavailable', '原生连接器状态暂时无法读取', true)
          if (!transport || transport.ingressOrigin !== cell.origin) throw unavailable()
          let inventory: NativeConnectorInventory
          try {
            const value = await transport.requestControl('connector.inventory', {}, signal)
            validateConnectorInventory(value); inventory = value
          } catch { throw unavailable() }
          await verify(); signal.throwIfAborted()
          return { inventory, authorization: 'not-evaluated' as const, toolCall: 'not-performed' as const }
        })
    } finally {
      this.active.delete(lifetime)
      const remaining = (this.pending.get(key) ?? 1) - 1
      if (remaining) this.pending.set(key, remaining); else this.pending.delete(key)
    }
  }
}
