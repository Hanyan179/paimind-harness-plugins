import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import { CellTransport } from './cell-transport.js'
import { CellTransportDirectory } from './cell-transport-directory.js'
import { RuntimeBindings, validatePrivateRuntimeCell, type PrivateRuntimeCell } from './runtime-bindings.js'
import { validateNativeConnectorRestoration } from '../../../deploy/enterprise/worker/runtime/native-control.mjs'

export interface RuntimeCellConfiguration extends PrivateRuntimeCell { readonly transportKey: string }
const cellKeys = ['cellId', 'tenantId', 'userId', 'role', 'revision', 'origin', 'containerId', 'imageId', 'volumeName', 'policyDigest', 'transportKey'].sort()
export function readRuntimeCellConfiguration(value: unknown, publicOrigin: string): RuntimeCellConfiguration {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !isDeepStrictEqual(Object.keys(value).sort(), cellKeys)) {
    throw Error('Exact private runtime cell configuration required')
  }
  const { transportKey, ...pin } = value as RuntimeCellConfiguration
  if (typeof transportKey !== 'string' || !/^[a-f0-9]{64}$/.test(transportKey)) throw Error('Invalid private transport configuration')
  return Object.freeze({ ...validatePrivateRuntimeCell(pin, publicOrigin), transportKey })
}
const pinOf = ({ transportKey: _key, ...pin }: RuntimeCellConfiguration): PrivateRuntimeCell => Object.freeze(pin)

/** Shared by startup and replacement: callbacks capture a complete pin, not
 * a mutable cellId lookup. Checks bracket asynchronous current-authority work. */
export async function openPinnedOriginAuthority(bindings: RuntimeBindings, cell: PrivateRuntimeCell, transport: CellTransport): Promise<void> {
  const pin = Object.freeze({ ...cell })
  const current = async <T>(signal: AbortSignal, action: () => Promise<T>): Promise<T> => {
    signal.throwIfAborted(); bindings.assertPrivateCell(pin)
    const value = await action()
    signal.throwIfAborted(); bindings.assertPrivateCell(pin)
    return value
  }
  await transport.openOriginAuthority(
    (input, signal) => current(signal, () => bindings.checkInteractiveOrigins(pin.cellId, input, signal)),
    (input, signal) => current(signal, () => bindings.authorizeInteractiveExecution(pin.cellId, input, signal)),
    (input, signal) => current(signal, () => bindings.deriveInteractiveOrigins(pin.cellId, input, signal)),
    (input, signal) => current(signal, () => bindings.sealJobOrigins(pin.cellId, input, signal)),
    (input, signal) => current(signal, () => bindings.readSkillEligibility(pin.cellId, input, signal)),
    (input, signal) => current(signal, () => bindings.readConnectorApproval(pin.cellId, input, signal)),
    (input, signal) => current(signal, () => bindings.authorizeConnectorExecution(pin.cellId, input, signal)))
}

/** Once the reverse authority is actually connected, explicitly revalidate
 * persisted enabled intent. No fresh enable, background retry or stale grant.
 * A missing/late reply stays unconfirmed; other account services still boot. */
export async function restorePinnedConnectors(bindings: RuntimeBindings, cell: PrivateRuntimeCell, transport: CellTransport,
  signal: AbortSignal): Promise<{ status: 'observed'; restored: string[]; pending: string[] } | { status: 'unconfirmed' }> {
  try {
    signal.throwIfAborted(); bindings.assertPrivateCell(cell)
    const result = await transport.requestControl('connector.restore', {}, signal)
    validateNativeConnectorRestoration(result)
    signal.throwIfAborted(); bindings.assertPrivateCell(cell)
    return { status: 'observed', ...result }
  } catch { return { status: 'unconfirmed' } }
}

/** Reload is an explicit operator signal against the original private file.
 * Credentials, TLS, tenant, feature approvals and development origins cannot
 * change through this path; the only accepted delta is one existing cell. */
export function readRuntimeReload(path: string, original: object): unknown {
  const stat = lstatSync(path)
  if (realpathSync(path) !== path || !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1
    || stat.uid !== process.getuid?.() || stat.mode & 0o077 || stat.size > 262144) throw Error('Unsafe private runtime reload file')
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  let bytes: Buffer
  try {
    const opened = fstatSync(fd)
    if (opened.ino !== stat.ino || opened.dev !== stat.dev || opened.size !== stat.size || opened.nlink !== 1) throw Error('Runtime reload file changed')
    bytes = readFileSync(fd)
    const after = fstatSync(fd)
    if (bytes.length !== stat.size || after.size !== stat.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) throw Error('Runtime reload file changed')
  } finally { closeSync(fd) }
  const next: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  if (!next || typeof next !== 'object' || Array.isArray(next)) throw Error('Runtime configuration object required')
  const { nativePrivateCells: _beforeCells, ...beforeCore } = original as Record<string, unknown>
  const { nativePrivateCells: nextCells, ...nextCore } = next as Record<string, unknown>
  if (!isDeepStrictEqual(beforeCore, nextCore)) throw Error('Runtime reload cannot change other startup configuration')
  return nextCells
}

export class RuntimeCellReloader {
  private cells: readonly RuntimeCellConfiguration[]
  private busy = false
  constructor(private readonly bindings: RuntimeBindings, private readonly transports: CellTransportDirectory,
    cells: readonly RuntimeCellConfiguration[], private readonly publicOrigin: string, private readonly signal: AbortSignal) {
    this.cells = cells.map(cell => readRuntimeCellConfiguration(cell, publicOrigin))
  }
  async apply(value: unknown): Promise<{ status: 'unchanged' } | { status: 'replaced'; cellId: string; revision: string }> {
    this.signal.throwIfAborted()
    if (this.busy) throw Error('Runtime replacement already in progress')
    if (!Array.isArray(value) || value.length !== this.cells.length || value.length < 1 || value.length > 128) throw Error('Existing runtime cell inventory required')
    const next = value.map(cell => readRuntimeCellConfiguration(cell, this.publicOrigin))
    if (new Set(next.map(cell => cell.cellId)).size !== next.length
      || next.some(cell => !this.cells.some(old => old.cellId === cell.cellId))) throw Error('Runtime reload cannot add or remove members')
    const changes = next.filter(cell => !isDeepStrictEqual(cell, this.cells.find(old => old.cellId === cell.cellId)))
    if (changes.length === 0) return { status: 'unchanged' }
    if (changes.length !== 1) throw Error('Runtime reload replaces exactly one member at a time')
    const replacement = changes[0]!, previous = this.cells.find(cell => cell.cellId === replacement.cellId)!
    if (replacement.transportKey !== previous.transportKey) throw Error('Runtime recovery retains the original private control volume')
    const oldPin = pinOf(previous), newPin = pinOf(replacement), oldTransport = this.transports.get(previous.origin)
    if (!oldTransport) throw Error('Previous private transport missing')
    this.busy = true
    let candidate: CellTransport | undefined, published = false
    const abort = () => candidate?.destroy()
    try {
      // No handshake (and no secret transmission) to a DB-unapproved endpoint.
      await this.bindings.verifyPrivateCellReplacement(oldPin, newPin, this.signal)
      candidate = new CellTransport(replacement.origin, replacement.transportKey)
      this.signal.addEventListener('abort', abort, { once: true }); this.signal.throwIfAborted()
      await openPinnedOriginAuthority(this.bindings, newPin, candidate)
      await this.bindings.replacePrivateCell(oldPin, newPin, () => {
        this.transports.replace(oldTransport, candidate!, newPin)
        published = true
      }, this.signal)
      this.cells = this.cells.map(cell => cell.cellId === replacement.cellId ? replacement : cell)
      // Retired callbacks reject by their old pin even before socket teardown.
      oldTransport.destroy()
      const connectorRecovery = await restorePinnedConnectors(this.bindings, newPin, candidate, this.signal)
      console.log(JSON.stringify({ event: 'connector-cold-restoration', cellId: newPin.cellId, ...connectorRecovery }))
      return { status: 'replaced', cellId: replacement.cellId, revision: replacement.revision }
    } finally {
      this.signal.removeEventListener('abort', abort)
      if (!published) candidate?.destroy()
      this.busy = false
    }
  }
}
