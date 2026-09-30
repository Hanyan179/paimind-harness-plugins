// @vitest-environment node
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mkdtemp, realpath, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, symbols } from '@deepseek-ai/cordis'
import { boot } from '@deepseek-ai/dsh-app-boot'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime, type ToolExecutionInput } from '@deepseek-ai/dsh-tools'
import { createNativeConnectorConfiguration } from '../src/connector-configuration.js'
import { nativeConnectorPhase } from '../src/connector-inventory.js'
import { createManagedHarnessConnectorProvider } from '../src/managed-connector.js'
import { installManagedHarnessToolGuard } from '../src/managed-runtime.js'
import { createManagedToolGuard, MEMBER_TOOL_POLICY } from '../../../deploy/enterprise/worker/runtime/member-tool-policy.mjs'

const native = createRequire(createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json'))
const mcp = native('@deepseek-ai/dsh-mcp-client'), anchor = native.resolve('@deepseek-ai/dsh-mcp-client/package.json')
const roots: Context[] = []
afterEach(async () => { for (const root of roots.splice(0).reverse()) await root.fiber.dispose() })
const signal = () => AbortSignal.timeout(10_000)
const request = (name: string): ToolExecutionInput => ({ name: `mcp__${name}__echo`, callId: 'activation-proof' as ToolExecutionInput['callId'], arguments: { message: 'proof' }, signal: signal() })
async function fixture(member = false) {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'paimind-connector-activation-'))), file = join(home, 'root.json'), directory = join(home, '.enterprise-connectors')
  await writeFile(file, '[]', { mode: 0o600 })
  const start = async () => {
    const root = await boot('connector-activation', file, [], undefined, pathToFileURL(native.resolve('@deepseek-ai/dsh/package.json')).href); roots.push(root)
    // Real selected provider and original registry. Placement is an explicit
    // local test domain, not a claim of final container confinement.
    const selected = createManagedHarnessConnectorProvider(root, mcp, { nodeExecutable: process.execPath, moduleAnchor: anchor, lookupCwd: home,
      prepare: r => ({ argv: r.argv, cwd: r.cwd, env: { ...r.env } }) }, ToolRuntime)
    const guard = installManagedHarnessToolGuard(root, member ? createManagedToolGuard({ role: 'member', policy: MEMBER_TOOL_POLICY }) : () => undefined)
    await root.plugin(SystemPrompt, {}); await root.plugin(selected.select(ToolRuntime) as typeof ToolRuntime, {})
    await vi.waitFor(() => guard.assertReady())
    const starts: string[] = [], loader = Reflect.get(root.loader, symbols.original), unwrap = loader.unwrapExports
    loader.unwrapExports = function (value: unknown) {
      const original = unwrap.call(this, value), managed = selected.select(original) as typeof mcp
      if (original?.apply !== mcp.apply) return managed
      return { ...managed, apply: async (ctx: Context, config: Record<string, unknown>) => { starts.push(String(config.serverName)); await managed.apply(ctx, config) } }
    }
    root.effect(() => () => { loader.unwrapExports = unwrap })
    const owner = await createNativeConnectorConfiguration(root, directory)
    const put = (id = 'sales', command = process.execPath) => owner.configure({ kind: 'upsert', entryId: id, expectedRevision: owner.read(signal()).revision,
      configuration: { transport: 'stdio', serverName: id, command,
        args: [fileURLToPath(new URL('./connector-native-server.mjs', import.meta.url)), anchor, id], cwd: home, env: {}, toolCallTimeoutMs: 1000,
        failOnStartupError: true, reconnect: { enabled: false, initialDelayMs: 100, maxDelayMs: 1000, maxAttempts: 1 } } }, signal())
    const input = (entryId = 'sales', enabled = true) => {
      const state = owner.activationState(signal()), row = state.entries.find(r => r.entryId === entryId)!
      return { entryId, enabled, expectedRevision: state.revision, configurationVersion: row.configurationVersion! }
    }
    const entry = (id = 'sales') => root.loader.resolve(`paimind-managed-connectors:${id}`)
    return { root, owner, starts, put, input, entry }
  }
  return { home, directory, persisted: join(directory, 'cordis.json'), start, ...await start() }
}

describe('native dependency-gated connector activation, not enterprise grant or Browser E2E', () => {
  it('isolates the selected host phase enum in compatibility and refuses unknown states',()=>{
    expect([0,1,2,3,4,5,null,undefined].map(nativeConnectorPhase)).toEqual(['pending','loading','active','failed','disposed','unloading',null,null])
    for(const value of [-1,6,NaN,1.5])expect(()=>nativeConnectorPhase(value)).toThrow()
  })
  it('requires explicit live authority, persists original enabled intent, calls the actual provider and awaits native disabling', async () => {
    const f = await fixture(); await f.put(); const before = await readFile(f.persisted, 'utf8'), input = f.input()
    await expect(f.owner.setActivation(input, signal())).rejects.toThrow('authority-required')
    expect(await readFile(f.persisted, 'utf8')).toBe(before); expect(f.starts).toEqual([])
    const lease = new AbortController(), authorize = vi.fn(async () => lease.signal)
    const enabled = await f.owner.setActivation(input, signal(), authorize)
    expect(authorize).toHaveBeenCalledTimes(2); expect(authorize.mock.calls[0]?.[0]).toMatchObject({ entryId: 'sales', configurationVersion: input.configurationVersion })
    expect(enabled).toMatchObject({ outcome: 'activated', state: { entries: [{ enabled: true, authority: 'live', phase: 2, connection: 'not-probed' }] } })
    const saved=await readFile(f.persisted,'utf8')
    expect(f.owner.observeActivation(signal())).toMatchObject({schema:'paimind.connector-observation/v1',entries:[{enabled:true,authority:'live',phase:'active',connection:'not-probed'}]})
    expect(await readFile(f.persisted,'utf8')).toBe(saved)
    expect(f.starts).toEqual(['sales']); expect((await f.root.tools.execute(request('sales'))).isError).toBe(false)
    const row = JSON.parse(await readFile(f.persisted, 'utf8'))[0]
    expect(row.disabled).toBe(false); expect(row.inject).toEqual([`paimindConnectorActivation_sales_${input.configurationVersion}`])
    expect(() => f.owner.read(signal())).toThrow() // no false disabled-only v1 response
    expect(await f.owner.setActivation(f.input('sales', false), signal())).toMatchObject({ outcome: 'disabled' })
    expect(f.root.tools.get(request('sales').name)).toBeUndefined()
    expect(f.owner.read(signal()).entries[0]?.enabled).toBe(false)
    expect(JSON.parse(await readFile(f.persisted, 'utf8'))[0].inject).toBeUndefined()
  })
  it('cold boots persisted enabled intent pending, without starting the provider until fresh exact authority is supplied', async () => {
    const f = await fixture(); await f.put(); const lease = new AbortController()
    await f.owner.setActivation(f.input(), signal(), async () => lease.signal)
    const before = await readFile(f.persisted, 'utf8'); await f.root.fiber.dispose()
    const next = await f.start()
    expect(next.starts).toEqual([]); expect(next.entry().fiber?.state).toBe(0)
    expect(next.root.tools.get(request('sales').name)).toBeUndefined(); expect(await readFile(f.persisted, 'utf8')).toBe(before)
    expect(next.owner.activationState(signal()).entries[0]).toMatchObject({ enabled: true, authority: 'absent' })
    const fresh = new AbortController()
    await next.owner.setActivation(next.input(), signal(), async () => fresh.signal)
    expect(next.starts).toEqual(['sales']); expect((await next.root.tools.execute(request('sales'))).isError).toBe(false)
    expect(await readFile(f.persisted, 'utf8')).toBe(before)
  })
  it('withdraws one exact connector without modifying enabled intent or disabling a sibling', async () => {
    const f = await fixture(); await f.put(); await f.put('support')
    const sales = new AbortController(), support = new AbortController()
    await f.owner.setActivation(f.input(), signal(), async () => sales.signal)
    await f.owner.setActivation(f.input('support'), signal(), async () => support.signal)
    const bytes = await readFile(f.persisted, 'utf8')
    sales.abort(); await f.owner.withdrawActivation('sales')
    expect(f.root.tools.get(request('sales').name)).toBeUndefined(); expect(f.entry().fiber?.state).toBe(0)
    expect((await f.root.tools.execute(request('support'))).isError).toBe(false); expect(await readFile(f.persisted, 'utf8')).toBe(bytes)
    expect(f.owner.activationState(signal()).entries.map(r => r.authority)).toEqual(['absent','live'])
  })
  it.each(['first','second'])('denies withdrawal during the %s asynchronous authority check without a provider launch', async phase => {
    const f = await fixture(); await f.put(); const before = await readFile(f.persisted, 'utf8'), lease = new AbortController(); let calls = 0
    const authorize = async () => { calls++; if (calls === (phase === 'first' ? 1 : 2)) await f.owner.withdrawActivation('sales'); return lease.signal }
    await expect(f.owner.setActivation(f.input(), signal(), authorize)).rejects.toThrow('activation-unconfirmed')
    expect(f.starts).toEqual([]); expect(f.root.tools.get(request('sales').name)).toBeUndefined()
    if (phase === 'first') expect(await readFile(f.persisted, 'utf8')).toBe(before)
    else expect(f.owner.activationState(signal()).entries[0]).toMatchObject({ enabled: true, authority: 'absent' })
  })
  it('keeps enabled intent gated when the second authority check denies; explicit disabling still works', async () => {
    const f = await fixture(); await f.put(); let calls = 0
    await expect(f.owner.setActivation(f.input(), signal(), async () => { if (++calls === 2) throw Error('Synthetic revocation'); return new AbortController().signal })).rejects.toThrow('activation-unconfirmed')
    expect(f.starts).toEqual([]); expect(f.entry().fiber?.state).toBe(0)
    await f.owner.setActivation(f.input('sales', false), signal()); expect(f.owner.read(signal()).entries[0]?.enabled).toBe(false)
  })
  it('rejects old revisions/versions, aborted authority and browser-shaped authority values without launching', async () => {
    const f = await fixture(); await f.put(); const before = await readFile(f.persisted, 'utf8'), input = f.input(), authorize = vi.fn(async () => new AbortController().signal)
    for (const patch of [{ expectedRevision: 'f'.repeat(64) }, { configurationVersion: 'e'.repeat(64) }]) expect((await f.owner.setActivation({ ...input, ...patch }, signal(), authorize)).outcome).toBe('conflict')
    expect(authorize).not.toHaveBeenCalled()
    const denied = new AbortController(); denied.abort()
    await expect(f.owner.setActivation(input, signal(), async () => denied.signal)).rejects.toThrow()
    await expect(f.owner.setActivation(input, signal(), async () => ({ aborted: false }) as AbortSignal)).rejects.toThrow()
    expect(await readFile(f.persisted, 'utf8')).toBe(before); expect(f.starts).toEqual([])
  })
  it('does not confuse a successful native activation with permission for a member tool call', async () => {
    const f = await fixture(true); await f.put()
    await f.owner.setActivation(f.input(), signal(), async () => new AbortController().signal)
    const result = await f.root.tools.execute({ ...request('sales'), agent: { id: 'a', session: { id: 's', events: [] } } as ToolExecutionInput['agent'] })
    expect(result.isError).toBe(true); expect(JSON.stringify(result)).toContain('当前账户未获授权使用此工具')
  })
  it('rejects tampered persistent dependency scope before importing or starting the provider', async () => {
    const f = await fixture(); await f.put(); await f.owner.setActivation(f.input(), signal(), async () => new AbortController().signal)
    await f.root.fiber.dispose(); const rows = JSON.parse(await readFile(f.persisted, 'utf8')); rows[0].inject = ['tools']
    await writeFile(f.persisted, JSON.stringify(rows), { mode: 0o600 })
    await expect(f.start()).rejects.toThrow('configuration unavailable')
  })
  it('can withdraw and disable a failed native startup rather than trapping an enabled record', async () => {
    const f = await fixture(); await f.put('sales', '/paimind-diagnostic-no-such-executable')
    await expect(f.owner.setActivation(f.input(), signal(), async () => new AbortController().signal)).rejects.toThrow('activation-unconfirmed')
    expect(f.owner.activationState(signal()).entries[0]).toMatchObject({ enabled: true, authority: 'absent', phase: 3 })
    await f.owner.withdrawActivation('sales')
    await f.owner.setActivation(f.input('sales', false), signal())
    expect(f.owner.read(signal()).entries[0]?.enabled).toBe(false)
    expect(f.root.tools.get(request('sales').name)).toBeUndefined()
  })
  it('does not turn a finished request lifetime into ongoing authority, while authority loss really unloads', async () => {
    const f = await fixture(); await f.put(); const requestLifetime = new AbortController(), authority = new AbortController()
    await f.owner.setActivation(f.input(), requestLifetime.signal, async () => authority.signal)
    requestLifetime.abort()
    expect((await f.root.tools.execute(request('sales'))).isError).toBe(false)
    authority.abort(); await f.owner.withdrawActivation('sales')
    expect(f.root.tools.get(request('sales').name)).toBeUndefined()
  })
  it('never activates the read-only legacy zero-attempt exception even when an opaque version exists', async () => {
    const f = await fixture(); await f.put(); await f.root.fiber.dispose()
    const rows = JSON.parse(await readFile(f.persisted, 'utf8')); rows[0].config.reconnect.maxAttempts = 0
    await writeFile(f.persisted, JSON.stringify(rows), { mode: 0o600 }); const next = await f.start(), bytes = await readFile(f.persisted, 'utf8')
    expect(next.owner.read(signal()).entries[0]?.enabled).toBe(false)
    await expect(next.owner.setActivation(next.input(), signal(), async () => new AbortController().signal)).rejects.toThrow('activation-unconfirmed')
    expect(next.starts).toEqual([]); expect(await readFile(f.persisted, 'utf8')).toBe(bytes)
  })
})
