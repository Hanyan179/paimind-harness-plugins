import type { CellTransport } from './cell-transport.js'
import type { PrivateRuntimeCell, RuntimeGrant } from './runtime-bindings.js'
import { EnterpriseError } from './errors.js'

type Selection = Pick<PrivateRuntimeCell, 'cellId' | 'tenantId' | 'userId' | 'role' | 'revision' | 'origin'>
const unavailable = () => new EnterpriseError(503, 'private-cell-unavailable', '运行连接的固定修订已变化', true)

/** Operator-owned live transport view; ordinary Maps remain snapshots.
 * Pins are connection provenance, not account records or authorization.
 * No reusable grants, native objects or persistent state are stored here. */
export class CellTransportDirectory implements ReadonlyMap<string, CellTransport> {
  private readonly entriesByOrigin: Map<string, CellTransport>
  private readonly pins = new WeakMap<CellTransport, PrivateRuntimeCell>()
  constructor(entries: ReadonlyMap<string, CellTransport>, cells: readonly PrivateRuntimeCell[] = []) {
    this.entriesByOrigin = new Map(entries)
    for (const [origin, transport] of this.entriesByOrigin) {
      if (origin !== transport.ingressOrigin) throw Error('Private transport directory origin mismatch')
    }
    for (const cell of cells) {
      const transport = this.get(cell.origin)
      if (!transport || this.pins.has(transport)) throw Error('Private transport pin mismatch')
      this.pins.set(transport, Object.freeze({ ...cell }))
    }
  }
  get size() { return this.entriesByOrigin.size }
  get(origin: string) { return this.entriesByOrigin.get(origin) }
  has(origin: string) { return this.entriesByOrigin.has(origin) }
  entries() { return this.entriesByOrigin.entries() }
  keys() { return this.entriesByOrigin.keys() }
  values() { return this.entriesByOrigin.values() }
  [Symbol.iterator]() { return this.entries() }
  forEach(callback: (value: CellTransport, key: string, map: ReadonlyMap<string, CellTransport>) => void, thisArg?: unknown) {
    this.entriesByOrigin.forEach((value, key) => callback.call(thisArg, value, key, this))
  }
  /** The request carries its admitted revision across awaited authorization.
   * An address reused by a replacement must never turn that stale admission
   * into a connection to the new runtime. This is transport provenance only. */
  select(cell: Selection): CellTransport | undefined {
    const transport = this.get(cell.origin)
    if (!transport) return undefined
    const pin = this.pins.get(transport)
    if (!pin || (['cellId', 'tenantId', 'userId', 'role', 'revision', 'origin'] as const).some(key => cell[key] !== pin[key])) throw unavailable()
    return transport
  }
  replace(previous: CellTransport, next: CellTransport, nextPin?: PrivateRuntimeCell): void {
    if (this.get(previous.ingressOrigin) !== previous || previous === next
      || next.ingressOrigin !== previous.ingressOrigin && this.has(next.ingressOrigin)
      || this.pins.has(previous) && !nextPin || nextPin && nextPin.origin !== next.ingressOrigin) {
      throw Error('Private transport replacement conflicts with current directory')
    }
    if (nextPin) this.pins.set(next, Object.freeze({ ...nextPin }))
    if (next.ingressOrigin !== previous.ingressOrigin) this.entriesByOrigin.delete(previous.ingressOrigin)
    this.entriesByOrigin.set(next.ingressOrigin, next)
  }
}

export function retainCellTransports(input?: ReadonlyMap<string, CellTransport>): ReadonlyMap<string, CellTransport> {
  return input instanceof CellTransportDirectory ? input : new Map(input)
}

export function selectCellTransport(input: ReadonlyMap<string, CellTransport>, cell: Selection & Pick<RuntimeGrant, 'transport'>): CellTransport | undefined {
  const transport = input instanceof CellTransportDirectory ? input.select(cell) : input.get(cell.origin)
  if (!transport && cell.transport === 'private-cell') throw unavailable()
  return transport
}
