import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync } from 'node:fs'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { dirname, isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import type { EntryOptions, EntryTree } from '@deepseek-ai/cordis-plugin-loader'
import { nativeConnectorPhase } from './connector-inventory.js'

const provider = '@deepseek-ai/dsh-mcp-client'
const includeId = 'paimind-managed-connectors'
const limit = 256 * 1024
const fail = (kind = 'unavailable'): never => { throw new Error(`Native connector configuration ${kind}`) }
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
function record(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!object(value) || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) fail('invalid')
}
function text(value: unknown, max: number, pattern?: RegExp): string {
  if (typeof value !== 'string' || !value || value.length > max || /[\u0000-\u001f\u007f]/u.test(value) || pattern && !pattern.test(value)) fail('invalid')
  return value as string
}
function integer(value: unknown, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) fail('invalid')
  return Number(value)
}
function pairs(value: unknown, names: RegExp): Record<string, string> {
  if (!object(value) || Object.keys(value).length > 64) return fail('invalid')
  return Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([key, v]) => {
    text(key, 128, names)
    if (['__proto__','constructor','prototype'].includes(key) || typeof v !== 'string' || v.length > 4096 || /[\u0000-\u001f\u007f]/u.test(v)) fail('invalid')
    return [key, v as string]
  }))
}
/** Literal selected-owner configuration only. No !!js, plugin names, loader
 * injection, arbitrary groups or implicit environment evaluation. These
 * configurations remain disabled until the separate approval/grant path exists. */
function configuration(value: unknown, retainedDisabled = false): Record<string, unknown> {
  if (!object(value)) return fail('invalid')
  const http = value.transport === 'streamable-http'
  if (!http && value.transport !== 'stdio') fail('invalid')
  record(value, ['transport','serverName','toolCallTimeoutMs','failOnStartupError','reconnect', ...(http ? ['url','headers'] : ['command','args','env','cwd'])])
  if (value.failOnStartupError !== true) fail('invalid')
  record(value.reconnect, ['enabled','initialDelayMs','maxDelayMs','maxAttempts'])
  if (typeof value.reconnect.enabled !== 'boolean') fail('invalid')
  const initialDelayMs = integer(value.reconnect.initialDelayMs, 100, 30_000)
  // RC.2 validates a positive attempt count even with reconnect disabled.
  // Earlier dormant records accepted zero. Preserve them byte-for-byte on
  // read/removal; only an explicit replacement may repair their configuration.
  // This exception must never be used by an activation/transport projection.
  const reconnect = { enabled: value.reconnect.enabled, initialDelayMs, maxDelayMs: integer(value.reconnect.maxDelayMs, initialDelayMs, 120_000), maxAttempts: integer(value.reconnect.maxAttempts, retainedDisabled ? 0 : 1, 10) }
  const common = { transport: value.transport, serverName: text(value.serverName, 32, /^[A-Za-z0-9_-]+$/u),
    toolCallTimeoutMs: integer(value.toolCallTimeoutMs, 1000, 60_000), failOnStartupError: true, reconnect }
  if (http) {
    let url: URL
    try { url = new URL(text(value.url, 8192)) } catch { return fail('invalid') }
    if (!['https:','http:'].includes(url.protocol) || url.username || url.password || url.hash) fail('invalid')
    return { ...common, url: url.href, headers: pairs(value.headers, /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u) }
  }
  if (!Array.isArray(value.args) || value.args.length > 64) fail('invalid')
  const args = (value.args as unknown[]).map(v => {
    if (typeof v !== 'string' || v.length > 4096 || /[\u0000-\u001f\u007f]/u.test(v)) return fail('invalid')
    return v
  })
  const cwd = text(value.cwd, 4096)
  if (!isAbsolute(cwd)) fail('invalid')
  return { ...common, command: text(value.command, 4096), args, cwd, env: pairs(value.env, /^[A-Za-z_][A-Za-z0-9_]*$/u) }
}
/** Internal execution projection shares the new-write contract, never the
 * read-only legacy exception. This validates syntax, not activation authority. */
export function normalizeNativeConnectorConfiguration(value: unknown): Record<string, unknown> {
  return configuration(value)
}
type ConnectorEntry = EntryOptions & { paimindVersionKey?: string }
interface ActivationReference {
  readonly entryId: string
  readonly configurationVersion: string
  readonly serverName: string
  readonly transport: 'stdio' | 'streamable-http'
}
// Trusted embedding callback, never serialized browser input. Its signal must
// be withdrawn on authority/channel loss. Current tool use is checked separately.
type ActivationAuthority = (reference: Readonly<ActivationReference>, signal: AbortSignal) => Promise<AbortSignal>
const activationDependency = (row: ConnectorEntry) => `paimindConnectorActivation_${row.id}_${version(row)}`
// This private random key stays in the original owner file. Public references
// cannot be used to guess secret configuration values from an unkeyed digest.
function version(row: ConnectorEntry): string | null {
  if (!row.paimindVersionKey) return null
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : object(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
  return createHmac('sha256', Buffer.from(row.paimindVersionKey, 'hex'))
    .update(JSON.stringify(canonical({ id: row.id, name: row.name, config: row.config }))).digest('hex')
}
function entries(value: unknown): ConnectorEntry[] {
  if (!Array.isArray(value) || value.length > 128) return fail('invalid')
  const ids = new Set<string>(), names = new Set<string>()
  const rows = value.map(row => {
    const versioned = object(row) && Object.hasOwn(row, 'paimindVersionKey')
    const enabled = object(row) && row.disabled === false
    record(row, ['id','name','disabled','config', ...(versioned ? ['paimindVersionKey'] : []), ...(enabled ? ['inject'] : [])])
    const id = text(row.id, 64, /^[A-Za-z0-9][A-Za-z0-9_-]*$/u)
    if (row.name !== provider || typeof row.disabled !== 'boolean' || ids.has(id)) fail('invalid')
    const config = configuration(row.config, !enabled), name = String(config.serverName)
    if (names.has(name)) fail('invalid')
    ids.add(id); names.add(name)
    const key = versioned ? text(row.paimindVersionKey, 64, /^[a-f0-9]{64}$/u) : undefined
    const result = { id, name: provider, disabled: !enabled, config, ...(key ? { paimindVersionKey: key } : {}) }
    if (enabled) {
      // Persist only the original Loader dependency, never a ready/granted bit.
      // Cold boot cannot invoke the provider before this exact gate is supplied.
      if (!key || !isDeepStrictEqual(row.inject, [activationDependency(result)])) fail('invalid')
      return { ...result, inject: [activationDependency(result)] }
    }
    return result
  })
  if (Buffer.byteLength(JSON.stringify(rows, null, 2)) > limit) fail('invalid')
  return rows
}
function privateDirectory(path: string): void {
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync.native(path) !== path || stat.uid !== process.getuid?.() || stat.mode & 0o077) fail()
}
function readDocument(path: string): { bytes: Buffer; rows: ConnectorEntry[] } {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || stat.mode & 0o077 || stat.size > limit) fail()
    const bytes = readFileSync(fd)
    if (bytes.length > limit) fail()
    return { bytes, rows: entries(JSON.parse(bytes.toString('utf8'))) }
  } finally { closeSync(fd) }
}
interface FileTree extends EntryTree {
  readonly filename: string
  readonly readonly: boolean
  flushWrite(): Promise<void>
}

/** The original cordis:include owns the sole JSON file and all entry objects.
 * Configuration writes remain disabled. The internal activation seam uses the
 * original Loader dependency lifecycle; a durable enabled intent never persists
 * current authority. No copied connection manager or tool registry is created. */
export async function createNativeConnectorConfiguration(context: Context, directory: string) {
  const filename = join(directory, 'cordis.json'), temporary = filename + '.tmp', key = randomBytes(32)
  let active = true, busy = false
  const gates = new Map<string, { version: string; close(): Promise<void> }>()
  const withdrawals = new Map<string, object>()
  const temporaryFile = () => { privateDirectory(directory); const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); closeSync(fd) }
  try {
    if (!isAbsolute(directory)) fail()
    privateDirectory(dirname(directory))
    try { mkdirSync(directory, { mode: 0o700 }) } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e }
    privateDirectory(directory)
    let missing = false
    try { readDocument(filename) } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; missing = true }
    // A pending .tmp is an unresolved prior native write, not permission to
    // overwrite it. Preserve it for operator inspection.
    try { lstatSync(temporary); fail() } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
    if ([...context.loader.entries()].some(e => e.id === includeId)) fail()
    if (typeof context.loader.builtins.include !== 'function') fail()
    if (missing) temporaryFile()
    const id = await context.loader.create({ id: includeId, name: 'cordis:include', config: { path: pathToFileURL(filename).href, initial: [] } } as EntryOptions)
    if (id !== includeId) fail()
    const tree = context.loader.resolve(id).subtree as FileTree | undefined
    if (!tree || tree.filename !== filename || tree.readonly || typeof tree.flushWrite !== 'function') fail()
    context.effect(() => async () => { active = false; key.fill(0); await Promise.all([...gates.values()].map(gate => gate.close())) })
    const check = (signal: AbortSignal) => { signal.throwIfAborted(); if (!active || busy) fail(busy ? 'busy' : 'unavailable'); privateDirectory(directory) }
    const observe = () => {
      if (!active) fail()
      const document = readDocument(filename)
      if (!isDeepStrictEqual(entries(tree!.root.data), document.rows)) fail()
      return { rows: document.rows, revision: createHmac('sha256', key).update(document.bytes).digest('hex') }
    }
    const runtimeState = () => {
      const current = observe()
      return Object.freeze({ schema: 'paimind.connector-activation/v1' as const, revision: current.revision,
        entries: Object.freeze(current.rows.map(row => {
          const entry = tree!.resolve(row.id), phase = entry.fiber?.state
          return Object.freeze({ entryId: row.id, configurationVersion: version(row), serverName: String(row.config.serverName),
            transport: row.config.transport as 'stdio' | 'streamable-http', enabled: row.disabled === false,
            authority: gates.has(row.id) ? 'live' as const : 'absent' as const,
            phase: phase ?? null, connection: 'not-probed' as const })
        })) })
    }
    const state = () => {
      const current = observe()
      // Preserve the old disabled-only v1 contract. Enabled intent must use the
      // separate lifecycle projection, never be falsely labelled disabled.
      if (current.rows.some(row => !row.disabled)) fail('activation-state-required')
      return Object.freeze({ schema: 'paimind.connector-configuration/v1' as const, revision: current.revision,
        activation: 'not-authorized' as const, entries: Object.freeze(current.rows.map(row => Object.freeze({ entryId: row.id,
          serverName: String(row.config.serverName), transport: row.config.transport as 'stdio' | 'streamable-http', enabled: false as const }))) })
    }
    const prepare = (input: unknown, signal: AbortSignal) => {
      check(signal)
      state()
      if (!object(input)) return fail('invalid')
      const kind = input.kind
      record(input, kind === 'upsert' ? ['kind','entryId','configuration','expectedRevision'] : ['kind','entryId','expectedRevision'])
      if (kind !== 'upsert' && kind !== 'remove') fail('invalid')
      const entryId = text(input.entryId, 64, /^[A-Za-z0-9][A-Za-z0-9_-]*$/u)
      const expected = text(input.expectedRevision, 64, /^[a-f0-9]{64}$/u), current = observe()
      if (!timingSafeEqual(Buffer.from(expected), Buffer.from(current.revision))) return { outcome: 'conflict' as const }
      const previous = current.rows.find(row => row.id === entryId)
      const config = kind === 'upsert' ? configuration(input.configuration) : undefined
      // Only an explicit write adds a version to legacy rows. Unchanged new
      // rows retain their exact key; changed/recreated rows get a fresh one.
      const candidate = config ? { id: entryId, name: provider, disabled: true, config,
        paimindVersionKey: previous?.paimindVersionKey && isDeepStrictEqual(config, previous.config)
          ? previous.paimindVersionKey : randomBytes(32).toString('hex') } : undefined
      const next = current.rows.flatMap<ConnectorEntry>(row => row.id !== entryId ? [row] : candidate ? [candidate] : [])
      if (candidate && !current.rows.some(row => row.id === entryId)) next.push(candidate)
      const normalized = entries(next)
      return { outcome: isDeepStrictEqual(normalized, current.rows) ? 'unchanged' as const : 'ready' as const, normalized }
    }
    const withdraw = async (entryId: string) => {
      const entry = tree!.store[entryId]
      if (entry) withdrawals.set(entryId, {})
      await gates.get(entryId)?.close()
      // Native provider effects own sockets/processes/tools. Await that owner,
      // not just removal of the readiness service.
      try { await entry?.fiber?.await() } catch (error) {
        // A settled native startup failure rethrows from await(), even after
        // its effects drained. It must not make withdrawal/disabling impossible.
        if (entry?.fiber?.state !== 3) throw error
      }
    }
    const persist = async (rows: ConnectorEntry[], signal: AbortSignal) => {
      signal.throwIfAborted(); temporaryFile()
      await tree!.root.update(rows)
      tree!.write(); await tree!.flushWrite()
      if (!isDeepStrictEqual(observe().rows, rows)) fail()
      signal.throwIfAborted()
    }
    runtimeState()
    return Object.freeze({
      activationState(signal: AbortSignal) { check(signal); return runtimeState() },
      observeActivation(signal: AbortSignal) {
        check(signal)
        const state = runtimeState()
        return Object.freeze({ schema: 'paimind.connector-observation/v1' as const, revision: state.revision,
          entries: Object.freeze(state.entries.map(entry => Object.freeze({ ...entry, phase: nativeConnectorPhase(entry.phase) }))) })
      },
      // Withdraw in-memory permission even during another pending operation.
      // This preserves enabled intent for explicit revalidation after recovery.
      async withdrawActivation(entryId: string) {
        text(entryId, 64, /^[A-Za-z0-9][A-Za-z0-9_-]*$/u)
        await withdraw(entryId)
      },
      async setActivation(input: unknown, signal: AbortSignal, authorize?: ActivationAuthority) {
        check(signal); record(input, ['entryId','configurationVersion','expectedRevision','enabled'])
        const entryId = text(input.entryId, 64, /^[A-Za-z0-9][A-Za-z0-9_-]*$/u)
        const expected = text(input.expectedRevision, 64, /^[a-f0-9]{64}$/u)
        const selected = text(input.configurationVersion, 64, /^[a-f0-9]{64}$/u)
        if (typeof input.enabled !== 'boolean') fail('invalid')
        const current = observe(), row = current.rows.find(row => row.id === entryId)
        if (expected !== current.revision || !row || version(row) !== selected) return { outcome: 'conflict' as const, state: runtimeState() }
        if (input.enabled && typeof authorize !== 'function') fail('authority-required')
        const reference = Object.freeze({ entryId, configurationVersion: selected, serverName: String(row.config.serverName), transport: row.config.transport as 'stdio' | 'streamable-http' })
        busy = true
        let startupClose: (() => Promise<void>) | undefined
        try {
          if (input.enabled) {
            let epoch = withdrawals.get(entryId)
            configuration(row.config) // Never activate the retained legacy exception.
            const permission = await authorize!(reference, signal)
            if (!(permission instanceof AbortSignal)) fail('authority-invalid')
            signal.throwIfAborted(); permission.throwIfAborted()
            if (!active || withdrawals.get(entryId) !== epoch || observe().revision !== expected) fail('changed')
            await withdraw(entryId)
            epoch = withdrawals.get(entryId)
            const enabled = { ...row, disabled: false, inject: [activationDependency(row)] }
            if (!isDeepStrictEqual(row, enabled)) await persist(entries(current.rows.map(r => r.id === entryId ? enabled : r)), signal)
            const persisted = observe()
            const fresh = await authorize!(reference, signal)
            if (!(fresh instanceof AbortSignal)) fail('authority-invalid')
            const lease = AbortSignal.any([permission, fresh])
            signal.throwIfAborted(); lease.throwIfAborted()
            if (!active || withdrawals.get(entryId) !== epoch || observe().revision !== persisted.revision) fail('changed')
            const entry = tree!.resolve(entryId)
            if (entry.disabled || !isDeepStrictEqual(entry.options, enabled) || context.get(activationDependency(row), false) !== undefined) fail('changed')
            const remove = context.provide(activationDependency(row), Object.freeze({}))
            let closure: Promise<void> | undefined
            const onAbort = () => { void close().catch(() => { active = false }) }
            const close = () => {
              if (closure) return closure
              lease.removeEventListener('abort', onAbort); signal.removeEventListener('abort', onAbort)
              if (gates.get(entryId)?.close === close) gates.delete(entryId)
              return closure = Promise.resolve(remove())
            }
            gates.set(entryId, { version: selected, close }); startupClose = close
            lease.addEventListener('abort', onAbort, { once: true }); signal.addEventListener('abort', onAbort, { once: true })
            if (lease.aborted || signal.aborted) await close()
            await entry.fiber?.await()
            signal.throwIfAborted(); lease.throwIfAborted()
            if (!active || gates.get(entryId)?.close !== close || entry.fiber?.state !== 2 || observe().revision !== persisted.revision) fail('unavailable')
            // An HTTP request deadline is not the ongoing authority lifetime.
            signal.removeEventListener('abort', onAbort); startupClose = undefined
          } else {
            await withdraw(entryId)
            const { inject: _inject, ...rest } = row, disabled = { ...rest, disabled: true }
            if (!isDeepStrictEqual(row, disabled)) await persist(entries(current.rows.map(r => r.id === entryId ? disabled : r)), signal)
          }
          return { outcome: input.enabled ? 'activated' as const : 'disabled' as const, state: runtimeState() }
        } catch {
          await startupClose?.(); await withdraw(entryId)
          signal.throwIfAborted(); return fail('activation-unconfirmed')
        } finally { busy = false }
      },
      read(signal: AbortSignal) { try { check(signal); return state() } catch { signal.throwIfAborted(); return fail() } },
      // Exact stable configuration identity only, not approval or permission.
      // Keep the existing v1 configuration projection unchanged for callers.
      release(input: unknown, signal: AbortSignal) {
        check(signal); record(input, ['entryId','expectedRevision'])
        const entryId = text(input.entryId, 64, /^[A-Za-z0-9][A-Za-z0-9_-]*$/u)
        const expected = text(input.expectedRevision, 64, /^[a-f0-9]{64}$/u), current = observe()
        if (!timingSafeEqual(Buffer.from(expected), Buffer.from(current.revision))) return { outcome: 'conflict' as const, revision: current.revision, reference: null }
        const row = current.rows.find(row => row.id === entryId), configurationVersion = row && version(row)
        if (!row || !configurationVersion) return { outcome: row ? 'unversioned' as const : 'missing' as const, revision: current.revision, reference: null }
        return { outcome: 'current' as const, revision: current.revision, reference: Object.freeze({ entryId,
          configurationVersion, serverName: String(row.config.serverName), transport: row.config.transport as 'stdio' | 'streamable-http' }) }
      },
      // The original owner validates before a durable command is reserved.
      // This observation carries neither a configuration copy nor a grant.
      prepare(input: unknown, signal: AbortSignal) { const planned = prepare(input, signal); return { outcome: planned.outcome, state: state() } },
      async configure(input: unknown, signal: AbortSignal) {
        const planned = prepare(input, signal)
        if (planned.outcome !== 'ready') return { outcome: planned.outcome, state: state() }
        const normalized = planned.normalized
        busy = true
        try {
          // Native Group update owns its transaction/rollback; native Include
          // owns serialization and disk replacement. Await its actual writer,
          // not merely the scheduled write or an in-memory option flag.
          await persist(normalized, signal)
          for (const id of withdrawals.keys()) if (!normalized.some(row => row.id === id)) withdrawals.delete(id)
          const after = state()
          if (!isDeepStrictEqual(observe().rows, normalized)) fail()
          signal.throwIfAborted()
          return { outcome: 'saved-disabled' as const, state: after }
        } catch { signal.throwIfAborted(); return fail() }
        finally { busy = false }
      },
    })
  } catch { return fail() }
}
