import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { createHarnessModelRead, decodeHarnessModelRead, decodeHarnessModelConfiguration, decodeHarnessModelCredentialState,
  type HarnessModelReadValues, type HarnessModelConfiguration } from '@paimind/harness-compat/gateway-transport'
import { EnterpriseError, invalid, record, text, uuid } from './errors.js'
import type { Identity } from './identity.js'
import type { RuntimeBindings, PrivateRuntimeCell } from './runtime-bindings.js'
import type { CellTransport } from './cell-transport.js'
import { retainCellTransports } from './cell-transport-directory.js'
import { requestNativeModel } from './model-transport.js'

type InspectionReads = Omit<HarnessModelReadValues, 'settings' | 'credentials'> & { settings: HarnessModelConfiguration;
  credentials: Array<{ ref: string; configured: boolean; writable: boolean }> }

/** Audited original-owner observations, never a model grant, copied settings
 * registry, credential resolver or write surface. */
export class ModelInspection {
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
    if (row.confirmed !== true) return invalid('请确认模型状态读取及审计提示')
    const memberId = uuid(row.memberId), reason = text(row.reason, 3, 500)
    const key = createHash('sha256').update(token ?? '').digest('hex')
    if (this.closed || this.active.size >= 8 || (this.pending.get(key) ?? 0) >= 2) {
      throw new EnterpriseError(503, 'model-state-busy', '模型状态读取已达上限，请稍后重试', true)
    }
    const lifetime = new AbortController(), signal = AbortSignal.any([lifetime.signal, cancellation, AbortSignal.timeout(15_000)])
    this.active.add(lifetime); this.pending.set(key, (this.pending.get(key) ?? 0) + 1)
    try {
      signal.throwIfAborted()
      return await this.identity.inspectMemberModels(token, memberId, reason, requestId, signal,
        (db, member) => this.bindings.selectManagedAccount(db, member), async (cell, verify) => {
          const read = async <K extends keyof HarnessModelReadValues>(kind: K, refs: readonly string[] = []) => {
            await verify(); signal.throwIfAborted()
            const value = await this.readNative(cell, kind, refs, signal)
            await verify(); signal.throwIfAborted(); return value
          }
          const settings = await read('settings'), providers = await read('providers'), catalog = await read('catalog')
          const selectedProvider = providers.find(row => row.provider === settings.selection?.provider)
          // No named reference means authentication is not inspected. Provider
          // record/OAuth/native fallback is never mislabeled as unconfigured.
          const credentialState = settings.credentialRef && selectedProvider?.active
            ? (await read('credentials', [settings.credentialRef]))[0]! : null
          const credential = credentialState ? credentialState.configured ? 'configured' : 'missing' : 'not-inspected'
          if (!isDeepStrictEqual(settings, await read('settings'))) {
            throw new EnterpriseError(409, 'model-state-changed', '读取期间默认模型设置已变化，请重新读取', true)
          }
          return { selection: settings.selection, providers, catalog, credential,
            configuration: { writable: settings.writable, revision: settings.revision, applies: settings.applies,
              cellRevision: cell.revision, credentialWritable: credentialState?.writable ?? null },
            providerActive: selectedProvider?.active ?? false,
            modelListed: catalog.groups.some(group => group.provider === settings.selection?.provider
              && group.models.some(model => model.id === settings.selection?.model)),
            authorization: 'not-evaluated' as const, modelCall: 'not-performed' as const }
        })
    } finally {
      this.active.delete(lifetime)
      const remaining = (this.pending.get(key) ?? 1) - 1
      if (remaining) this.pending.set(key, remaining); else this.pending.delete(key)
    }
  }
  private async readNative<K extends keyof InspectionReads>(cell: PrivateRuntimeCell, kind: K, refs: readonly string[], signal: AbortSignal): Promise<InspectionReads[K]> {
    const rpcId = randomUUID(), wire = createHarnessModelRead(kind, rpcId, refs)
    const text = await requestNativeModel(this.transports, cell, wire, signal)
    return (kind === 'settings' ? decodeHarnessModelConfiguration(text, rpcId)
      : kind === 'credentials' ? [decodeHarnessModelCredentialState(text, rpcId, refs[0]!)] : decodeHarnessModelRead(text, rpcId, kind, refs)) as InspectionReads[K]
  }
}
