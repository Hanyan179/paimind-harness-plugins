// @vitest-environment node
import { mkdtemp, realpath, writeFile, readFile, stat, mkdir, symlink, link } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { boot } from '@deepseek-ai/dsh-app-boot'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNativeConnectorConfiguration } from '../src/connector-configuration.js'
import { handleNativeControl } from '../../../deploy/enterprise/worker/runtime/native-control.mjs'

const closes: Array<() => Promise<unknown>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const close of closes.splice(0).reverse()) await close() })
const signal = () => new AbortController().signal
const http = (serverName = 'sales') => ({ transport: 'streamable-http', serverName, url: 'https://example.invalid/mcp',
  headers: { Authorization: 'Bearer SYNTHETIC_SECRET' }, toolCallTimeoutMs: 5000, failOnStartupError: true,
  reconnect: { enabled: false, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 1 } })
const stdio = () => ({ transport: 'stdio', serverName: 'local', command: '/NOT_EXECUTED', args: ['SYNTHETIC_PRIVATE_ARG'], cwd: '/NOT_OPENED', env: { API_KEY: 'SYNTHETIC_SECRET' },
  toolCallTimeoutMs: 5000, failOnStartupError: true, reconnect: { enabled: false, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 1 } })
async function fixture() {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'paimind-native-connectors-'))), rootFile = join(home, 'root.json'), directory = join(home, '.enterprise-connectors')
  await writeFile(rootFile, '[]', { mode: 0o600 })
  const start = async () => {
    const context = await boot('connector-owner-test', rootFile, [])
    closes.push(async () => { await context.fiber.dispose().catch(() => {}) })
    return context
  }
  return { home, rootFile, directory, filename: join(directory, 'cordis.json'), start }
}
async function opened() {
  const f = await fixture(), context = await f.start(), owner = await createNativeConnectorConfiguration(context, f.directory)
  return { ...f, context, owner, upsert: (entryId: string, configuration: unknown = http(entryId), expectedRevision = owner.read(signal()).revision) =>
    owner.configure({ kind: 'upsert', entryId, configuration, expectedRevision }, signal()) }
}
describe('connector drafts persisted by the actual selected native Include, never activation or a tool grant', () => {
  it('saves both transports in the original native file with private permissions, exact dormant entries and no returned secrets', async () => {
    const f = await opened()
    for (const [id, config] of [['sales', http()], ['local', stdio()]] as const) {
      const result = await f.upsert(id, config)
      expect(result.outcome).toBe('saved-disabled'); expect(result.state.activation).toBe('not-authorized')
      expect(JSON.stringify(result)).not.toMatch(/SYNTHETIC|example.invalid|NOT_EXECUTED|NOT_OPENED/u)
      const entry = f.context.loader.resolve('paimind-managed-connectors:' + id)
      expect(entry.options.name).toBe('@deepseek-ai/dsh-mcp-client'); expect(entry.disabled).toBe(true); expect(entry.fiber).toBeUndefined()
    }
    const file = JSON.parse(await readFile(f.filename, 'utf8'))
    expect(file.map((r: any) => r.id)).toEqual(['sales','local'])
    expect(file[0].config.headers.Authorization).toBe('Bearer SYNTHETIC_SECRET')
    expect((await stat(f.filename)).mode & 0o777).toBe(0o600)
    expect(await readFile(f.rootFile, 'utf8')).toBe('[]')
    await expect(stat(f.filename + '.tmp')).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('edits and deletes exact records, preserves siblings, detects stale revisions, and does not rewrite an unchanged value', async () => {
    const f = await opened()
    await f.upsert('sales'); await f.upsert('support')
    const old = f.owner.read(signal()).revision, before = await readFile(f.filename, 'utf8')
    expect((await f.upsert('sales')).outcome).toBe('unchanged'); expect(await readFile(f.filename, 'utf8')).toBe(before)
    const updated = await f.upsert('sales', { ...http(), url: 'https://example.invalid/changed' })
    expect(updated.outcome).toBe('saved-disabled'); expect(updated.state.revision).not.toBe(old)
    expect((await f.upsert('sales', http(), old)).outcome).toBe('conflict')
    const removed = await f.owner.configure({ kind: 'remove', entryId: 'sales', expectedRevision: updated.state.revision }, signal())
    expect(removed.outcome).toBe('saved-disabled'); expect(removed.state.entries.map(r => r.entryId)).toEqual(['support'])
    expect(() => f.context.loader.resolve('paimind-managed-connectors:sales')).toThrow()
  })
  it('rejects zero attempts for new commands but preserves earlier dormant records until explicitly repaired or removed', async () => {
    const f = await fixture(); await mkdir(f.directory, { mode: 0o700 })
    const legacy = { ...http(), reconnect: { ...http().reconnect, maxAttempts: 0 } }
    const bytes = JSON.stringify([{ id: 'legacy', name: '@deepseek-ai/dsh-mcp-client', disabled: true, config: legacy }], null, 2)
    await writeFile(f.filename, bytes, { mode: 0o600 })
    const context = await f.start(), owner = await createNativeConnectorConfiguration(context, f.directory)
    const state = owner.read(signal())
    expect(state.entries[0]?.enabled).toBe(false); expect(await readFile(f.filename, 'utf8')).toBe(bytes)
    for (const enabled of [false, true]) {
      const input = { kind: 'upsert', entryId: 'legacy', configuration: { ...legacy, reconnect: { ...legacy.reconnect, enabled } }, expectedRevision: state.revision }
      expect(() => owner.prepare(input, signal())).toThrow('Native connector configuration invalid')
      await expect(owner.configure(input, signal())).rejects.toThrow('Native connector configuration invalid')
      expect(await readFile(f.filename, 'utf8')).toBe(bytes)
    }
    await owner.configure({ kind: 'upsert', entryId: 'sibling', configuration: http('sibling'), expectedRevision: state.revision }, signal())
    expect(JSON.parse(await readFile(f.filename, 'utf8'))[0].config).toEqual(legacy)
    await owner.configure({ kind: 'upsert', entryId: 'legacy', configuration: http(), expectedRevision: owner.read(signal()).revision }, signal())
    expect(JSON.parse(await readFile(f.filename, 'utf8'))[0].config.reconnect.maxAttempts).toBe(1)
    expect(context.loader.resolve('paimind-managed-connectors:legacy').fiber).toBeUndefined()
    await owner.configure({ kind: 'remove', entryId: 'legacy', expectedRevision: owner.read(signal()).revision }, signal())
    expect(owner.read(signal()).entries.map(e => e.entryId)).toEqual(['sibling'])
  })
  it('reopens the same native file after disposing the owner, preserving configuration but invalidating old process revisions', async () => {
    const f = await opened(); await f.upsert('sales')
    const before = await readFile(f.filename, 'utf8'), old = f.owner.read(signal()).revision
    await f.context.fiber.dispose()
    expect(() => f.owner.read(signal())).toThrow('Native connector configuration unavailable')
    const nextContext = await f.start(), next = await createNativeConnectorConfiguration(nextContext, f.directory)
    expect(next.read(signal()).entries).toEqual([{ entryId: 'sales', serverName: 'sales', transport: 'streamable-http', enabled: false }])
    expect(next.read(signal()).revision).not.toBe(old); expect(await readFile(f.filename, 'utf8')).toBe(before)
    expect((await next.configure({ kind: 'remove', entryId: 'sales', expectedRevision: old }, signal())).outcome).toBe('conflict')
  })
  it('rejects expressions, invalid URLs, names, headers, unbounded reconnect and extra owner/activation fields without writing', async () => {
    const f = await opened(), before = await readFile(f.filename, 'utf8')
    for (const config of [{ ...http(), url: 'SYNTHETIC_SECRET invalid URL' }, { ...http(), url: 'file:///etc/passwd' },
      { ...http(), url: 'https://user:password@example.invalid' }, { ...http(), url: 'https://example.invalid/#fragment' },
      { ...http(), serverName: { __jsExpr: 'process.exit()' } }, { ...http(), disabled: false }, { ...http(), failOnStartupError: false },
      { ...http(), reconnect: { ...http().reconnect, maxAttempts: 10000 } }, { ...http(), headers: { Authorization: 'bad\r\nheader' } },
      { ...stdio(), command: { __jsExpr: 'SYNTHETIC_SECRET' } }]) {
      await expect(f.upsert('sales', config)).rejects.toThrow('Native connector configuration invalid')
      expect(await readFile(f.filename, 'utf8')).toBe(before)
    }
    await f.upsert('sales')
    await expect(f.upsert('another', http())).rejects.toThrow('Native connector configuration invalid')
  })
  it.each(['active', 'foreign', 'expression', 'extra'] as const)('refuses preexisting %s records before the native Include can import any plugin', async kind => {
    const f = await fixture(); await mkdir(f.directory, { mode: 0o700 })
    const row: any = { id: 'sales', name: '@deepseek-ai/dsh-mcp-client', disabled: true, config: http() }
    if (kind === 'active') row.disabled = false
    if (kind === 'foreign') row.name = '/NOT_IMPORTED'
    if (kind === 'expression') row.config.headers.Authorization = { __jsExpr: 'process.exit()' }
    if (kind === 'extra') row.inject = { unsafe: true }
    const bytes = JSON.stringify([row]); await writeFile(f.filename, bytes, { mode: 0o600 })
    const context = await f.start()
    await expect(createNativeConnectorConfiguration(context, f.directory)).rejects.toThrow('Native connector configuration unavailable')
    expect(await readFile(f.filename, 'utf8')).toBe(bytes)
    expect(() => context.loader.resolve('paimind-managed-connectors')).toThrow()
  })
  it.each(['symlink','hardlink','pending-write'] as const)('preserves and refuses a %s instead of truncating a redirected or uncertain file', async kind => {
    const f = await fixture(); await mkdir(f.directory, { mode: 0o700 })
    const source = join(f.home, 'retained.json'); await writeFile(source, '[]', { mode: 0o600 })
    if (kind === 'symlink') await symlink(source, f.filename)
    if (kind === 'hardlink') await link(source, f.filename)
    if (kind === 'pending-write') { await writeFile(f.filename, '[]', { mode: 0o600 }); await writeFile(f.filename + '.tmp', 'UNCERTAIN', { mode: 0o600 }) }
    await expect(createNativeConnectorConfiguration(await f.start(), f.directory)).rejects.toThrow()
    expect(await readFile(source, 'utf8')).toBe('[]')
    if (kind === 'pending-write') expect(await readFile(f.filename + '.tmp', 'utf8')).toBe('UNCERTAIN')
  })
  it('refuses concurrent requests and aborted input; cancellation after persistence is never reported as a rollback', async () => {
    const f = await opened(), before = await readFile(f.filename, 'utf8'), stop = new AbortController()
    stop.abort()
    await expect(f.owner.configure({ kind: 'remove', entryId: 'sales', expectedRevision: f.owner.read(signal()).revision }, stop.signal)).rejects.toThrow()
    expect(await readFile(f.filename, 'utf8')).toBe(before)
    const tree = f.context.loader.resolve('paimind-managed-connectors').subtree as any, original = tree.flushWrite.bind(tree)
    let release!: () => void, persisted!: () => void
    const wait = new Promise<void>(r => { release = r }), done = new Promise<void>(r => { persisted = r }), canceled = new AbortController()
    vi.spyOn(tree, 'flushWrite').mockImplementation(async () => { await original(); persisted(); await wait })
    const pending = f.owner.configure({ kind: 'upsert', entryId: 'sales', configuration: http(), expectedRevision: f.owner.read(signal()).revision }, canceled.signal)
    const rejected = expect(pending).rejects.toThrow()
    await done
    await expect(f.owner.configure({}, signal())).rejects.toThrow('Native connector configuration busy')
    canceled.abort(); release(); await rejected
    expect(JSON.parse(await readFile(f.filename, 'utf8'))[0].id).toBe('sales')
    expect(f.owner.read(signal()).entries[0]?.enabled).toBe(false)
  })
  it('uses the actual owner behind the private control operations and rejects attempts to add a public activation flag', async () => {
    const f = await opened(); f.context.provide('paimindNativeConnectorConfiguration', f.owner)
    const state = await handleNativeControl(f.context, 'connector.configuration', {}, signal()) as any
    const result = await handleNativeControl(f.context, 'connector.configure', { kind: 'upsert', entryId: 'sales', configuration: http(), expectedRevision: state.revision }, signal()) as any
    expect(result.outcome).toBe('saved-disabled'); expect(JSON.stringify(result)).not.toContain('SYNTHETIC')
    await expect(handleNativeControl(f.context, 'connector.configure', { kind: 'enable', entryId: 'sales', expectedRevision: result.state.revision }, signal())).rejects.toThrow()
    await expect(handleNativeControl(f.context, 'connector.configuration', { origin: 'http://127.0.0.1:3080' }, signal())).rejects.toThrow()
  })
  it('does not acknowledge an original-owner persistence failure or treat divergent memory as a saved configuration', async () => {
    const f = await opened(), before = await readFile(f.filename, 'utf8')
    const tree = f.context.loader.resolve('paimind-managed-connectors').subtree as any
    // Explicit I/O fault at the actual native writer, not a replacement store.
    vi.spyOn(tree, '_writeFile').mockRejectedValue(new Error('SYNTHETIC_PRIVATE_DISK_FAILURE'))
    await expect(f.upsert('sales')).rejects.toThrow('Native connector configuration unavailable')
    expect(await readFile(f.filename, 'utf8')).toBe(before)
    expect(() => f.owner.read(signal())).toThrow('Native connector configuration unavailable')
    expect(await readFile(f.filename + '.tmp', 'utf8')).toBe('')
    await expect(f.owner.configure({ kind: 'upsert', entryId: 'again', configuration: http('again'), expectedRevision: 'a'.repeat(64) }, signal())).rejects.toThrow('Native connector configuration unavailable')
  })
})
