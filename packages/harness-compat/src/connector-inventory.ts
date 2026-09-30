import type Loader from '@deepseek-ai/cordis-plugin-loader'

const provider = '@deepseek-ai/dsh-mcp-client'
// Selected Cordis 4.0.1 exposes FiberState as an ambient const enum, not a
// runtime export. Isolate its published numeric contract here; unknown values
// fail closed. Native Loader tests exercise the real states independently.
const phases = { 0: 'pending', 1: 'loading', 2: 'active', 3: 'failed', 4: 'disposed', 5: 'unloading' } as const
const unavailable = (): never => { throw new Error('Native connector inventory unavailable') }
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
export function nativeConnectorPhase(state: number | null | undefined): typeof phases[keyof typeof phases] | null {
  if (state === null || state === undefined) return null
  if (!Object.hasOwn(phases, state)) return unavailable()
  return phases[state as keyof typeof phases]
}

/** Original Loader observation, not a connection probe, permission grant or
 * new registry. Never expose URLs, process arguments, environment, headers,
 * credentials, schemas, raw expressions or plugin errors. */
export function readNativeConnectorInventory(context: { get(name: 'loader'): unknown }, signal: AbortSignal) {
  signal.throwIfAborted()
  try {
    const loader = context.get('loader') as Loader | undefined
    if (typeof loader?.entries !== 'function') return unavailable()
    const entries: Array<Readonly<{ entryId: string; serverName: string | null; transport: 'stdio' | 'streamable-http' | null;
      enabled: boolean; phase: typeof phases[keyof typeof phases] | null; configuration: 'recognized' | 'unresolved' }>> = []
    const ids = new Set<string>()
    let visited = 0
    for (const entry of loader.entries()) {
      signal.throwIfAborted()
      if (++visited > 4096) return unavailable()
      if (entry.options.name !== provider) continue
      const entryId = entry.id
      if (entries.length >= 128 || typeof entryId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,255}$/u.test(entryId) || ids.has(entryId)) return unavailable()
      ids.add(entryId)
      // Native disabled includes owning groups and expressions. Do not infer
      // effective enabledness from this row's raw disabled option alone.
      const disabled = entry.disabled
      if (typeof disabled !== 'boolean') return unavailable()
      const fiber = entry.fiber
      const phase = nativeConnectorPhase(fiber?.state)
      // Use resolved config only when the original owner currently has an
      // active fiber; otherwise report literal metadata without evaluating it.
      const raw: unknown = fiber?.state === 2 ? fiber.config : entry.options.config
      const config = object(raw) ? raw : {}
      const serverName = typeof config.serverName === 'string' && /^[A-Za-z0-9_-]{1,32}$/u.test(config.serverName) ? config.serverName : null
      const transport = config.transport === 'stdio' || config.transport === 'streamable-http' ? config.transport : null
      entries.push(Object.freeze({ entryId, serverName, transport, enabled: !disabled, phase,
        configuration: serverName !== null && transport !== null ? 'recognized' : 'unresolved' }))
    }
    signal.throwIfAborted()
    return Object.freeze({ schema: 'paimind.native-connectors/v1' as const, scope: 'loader-tree' as const,
      connection: 'not-probed' as const, entries: Object.freeze(entries.sort((a,b) => a.entryId.localeCompare(b.entryId))) })
  } catch {
    signal.throwIfAborted()
    return unavailable()
  }
}
