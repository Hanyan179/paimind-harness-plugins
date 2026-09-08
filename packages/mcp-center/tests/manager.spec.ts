// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { McpConnectionManager, type McpRuntimeProjection } from '../src/manager.js'
import { FileMcpConnectionRepository } from '../src/repository.js'
import type { McpConfiguration, McpConnection } from '../src/contract.js'
import type { PaimindMcpAgent } from '@hansen/harness-compat/native-mcp'

const id = 'a'.repeat(32)
const config: McpConfiguration = { id, name: 'Feishu', category: 'documents', enabled: true, timeoutMs: 60000, transport: 'stdio', command: 'node', args: ['server.js'], cwd: '/tmp', envRefs: {} }
const agent = (id: string): PaimindMcpAgent => ({ id, session: { id, header: { agentPreset: id } }, ctx: {} })
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
function fixture() {
  let rows: McpConnection[] = []
  const selected = new Map<string, readonly string[]>([['a', [id]], ['b', [id]], ['c', []]])
  const names = new Map<string, string>(), disposers: ReturnType<typeof vi.fn>[] = []
  const runtime: McpRuntimeProjection = {
    preset: a => a.session.header.agentPreset,
    credential: async () => 'resolved-secret',
    probe: vi.fn(async () => [{ name: 'read', description: 'Read document' }]),
    mount: vi.fn(async (a, conf) => {
      const name = `mcp__${conf.serverName}__read`; names.set(a.id, name)
      const dispose = vi.fn(async () => {}); disposers.push(dispose)
      return { tools: () => dispose.mock.calls.length ? [] : [{ name, description: 'Read document' }], dispose }
    }),
  }
  const manager = new McpConnectionManager({ load: async () => rows, replace: async (_, next) => { rows = [...next] } }, { currentOwner: () => 'local-test' }, runtime, () => ({
    listProfiles: async () => ({ profiles: [...selected].map(([presetId, connectionIds]) => ({ presetId, name: presetId, connectionIds })) }),
    connectionIdsForPreset: async preset => selected.get(preset) ?? [],
  }))
  return { manager, runtime, selected, names, disposers, rows: () => rows }
}
describe('connection configuration and native scope reconciliation', () => {
  it('probes new and edited drafts without persisting, mounting or changing saved health and Agent bindings', async () => {
    const f = fixture(), a = agent('a')
    const draft = { ...config, id: 'b'.repeat(32), name: 'Unsaved' }
    expect((await f.manager.probeDraft({ configuration: draft })).evidence.status).toBe('passed')
    expect(f.rows()).toEqual([])
    expect((await f.manager.list()).items).toEqual([])
    expect(f.runtime.mount).not.toHaveBeenCalled()
    await f.manager.save({ configuration: config, expectedRevision: 0 })
    await f.manager.probe({ id, expectedRevision: 1 })
    await f.manager.reconcile(a)
    const before = await f.manager.list(), rows = JSON.stringify(f.rows())
    vi.mocked(f.runtime.probe).mockRejectedValueOnce(new Error('401 secret=hidden'))
    const result = await f.manager.probeDraft({ configuration: { id, name: 'Remote draft', category: 'data', enabled: true, timeoutMs: 5000, transport: 'streamable-http', url: 'https://example.invalid/mcp', headerRefs: { Authorization: 'MY_TOKEN' } } })
    expect(result.evidence.status).toBe('failed')
    expect(result.evidence.message).toContain('权限不足')
    expect(JSON.stringify(result)).not.toContain('hidden')
    expect(f.runtime.probe).toHaveBeenLastCalledWith(expect.objectContaining({ transport: 'streamable-http', headers: { Authorization: 'resolved-secret' } }))
    expect(await f.manager.list()).toEqual(before)
    expect(JSON.stringify(f.rows())).toBe(rows)
    expect(f.runtime.mount).toHaveBeenCalledOnce()
    expect(f.disposers[0]).not.toHaveBeenCalled()
    expect(f.manager.guard(f.names.get('a')!, a)).toBeUndefined()
    expect(f.selected.get('a')).toEqual([id])
    await expect(f.manager.probeDraft({ configuration: { ...draft, timeoutMs: 0 } })).rejects.toThrow()
    expect(f.runtime.probe).toHaveBeenCalledTimes(3)
    await f.manager.dispose()
  })
  it('does not delay existing Agent reconciliation behind a slow draft probe', async () => {
    const f = fixture()
    await f.manager.save({ configuration: config, expectedRevision: 0 })
    let finish!: () => void
    vi.mocked(f.runtime.probe).mockImplementationOnce(async () => { await new Promise<void>(resolve => { finish = resolve }); return [] })
    const probe = f.manager.probeDraft({ configuration: { ...config, id: 'c'.repeat(32) } })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    try { await f.manager.reconcile(agent('a')); expect(f.runtime.mount).toHaveBeenCalledOnce() }
    finally { finish(); await probe; await f.manager.dispose() }
  })
  it('projects source-owned display names without connecting or exposing configuration, including cold history and disabled scopes', async () => {
    const f = fixture(), a = agent('a')
    await f.manager.save({ configuration: { ...config, name: 'Generic documents' }, expectedRevision: 0 })
    const before = await f.manager.summarizeSession({ sessionId: 'a' })
    expect(before.items[0]).toEqual({ id, name: 'Generic documents', server: expect.any(String), enabled: true, mounted: false })
    expect(f.runtime.mount).not.toHaveBeenCalled()
    expect(f.runtime.probe).not.toHaveBeenCalled()
    await f.manager.reconcile(a)
    const live = await f.manager.summarizeSession({ sessionId: 'a' })
    expect(f.names.get('a')).toBe(`mcp__${live.items[0]!.server}__read`)
    expect(live.items[0]?.mounted).toBe(true)
    const other = await f.manager.summarizeSession({ sessionId: 'c' })
    expect(other.items[0]?.mounted).toBe(false)
    expect(other.items[0]?.server).not.toBe(live.items[0]?.server)
    await f.manager.setEnabled({ id, expectedRevision: 1, enabled: false })
    expect((await f.manager.summarizeSession({ sessionId: 'a' })).items[0]).toEqual({ ...live.items[0], enabled: false, mounted: false })
    expect(JSON.stringify(live)).not.toMatch(/server.js|command|envRefs|owner|credential/)
    await f.manager.dispose()
    await expect(f.manager.summarizeSession({ sessionId: 'a' })).rejects.toThrow('unloaded')
  })
  it('isolates two bound Agents from an unbound Agent and withdraws tools in already-open scopes', async () => {
    const f = fixture(), a = agent('a'), b = agent('b'), c = agent('c')
    await f.manager.save({ configuration: config, expectedRevision: 0 })
    await Promise.all([a, b, c].map(a => f.manager.reconcile(a)))
    expect(f.runtime.mount).toHaveBeenCalledTimes(2)
    expect(f.names.get('a')).not.toEqual(f.names.get('b'))
    expect(f.manager.guard(f.names.get('a')!, a)).toBeUndefined()
    expect(f.manager.guard(f.names.get('a')!, b)).toBeDefined()
    expect(f.manager.guard(f.names.get('a')!, c)).toBeDefined()
    f.selected.set('a', [])
    const unbind = f.manager.bindingsChanged()
    expect(f.manager.guard(f.names.get('a')!, a)).toBeDefined()
    await unbind
    expect(f.disposers[0]).toHaveBeenCalledOnce()
    expect(f.manager.guard(f.names.get('b')!, b)).toBeUndefined()
    const disable = f.manager.setEnabled({ id, expectedRevision: 1, enabled: false })
    expect(f.manager.guard(f.names.get('b')!, b)).toBeDefined()
    expect((await disable).state).toBe('disabled')
    expect(f.disposers[1]).toHaveBeenCalledOnce()
    await f.manager.setEnabled({ id, expectedRevision: 2, enabled: true })
    expect(f.runtime.probe).toHaveBeenCalledOnce()
    expect(f.runtime.mount).toHaveBeenCalledTimes(3)
    await f.manager.dispose()
    expect(f.manager.guard(f.names.get('b')!, b)).toBeDefined()
    expect(f.disposers.every(fn => fn.mock.calls.length === 1)).toBe(true)
  })
  it('rejects stale edits, requires affected-Agent acknowledgement, and keeps their other references', async () => {
    const f = fixture()
    await f.manager.save({ configuration: config, expectedRevision: 0 })
    await expect(f.manager.save({ configuration: { ...config, name: 'stale' }, expectedRevision: 0 })).rejects.toThrow('更新')
    await expect(f.manager.remove({ id, expectedRevision: 1, acknowledgeBindings: false })).rejects.toThrow('确认')
    await f.manager.remove({ id, expectedRevision: 1, acknowledgeBindings: true })
    expect(f.selected.get('b')).toEqual([id])
    await expect(f.manager.validateSelection([id])).rejects.toThrow('不存在')
    expect((await f.manager.list()).items).toEqual([])
    await f.manager.dispose()
  })
  it('keeps connection probes separate from business results and persists only configuration', async () => {
    const f = fixture(), a = agent('a')
    await f.manager.save({ configuration: config, expectedRevision: 0 })
    const probed = await f.manager.probe({ id, expectedRevision: 1 })
    expect(probed.probe?.status).toBe('passed'); expect(probed.business).toBeNull()
    expect(f.runtime.mount).not.toHaveBeenCalled()
    await f.manager.reconcile(a)
    f.manager.observe(f.names.get('a')!, false)
    expect((await f.manager.list()).items[0]?.business?.status).toBe('unknown')
    expect(Object.keys(f.rows()[0]!)).toEqual(['configuration', 'owner', 'revision', 'updatedAt'])
    vi.mocked(f.runtime.probe).mockRejectedValueOnce(new Error('permission denied secret=abc'))
    const failed = await f.manager.probe({ id, expectedRevision: 1 })
    expect(failed.state).toBe('error'); expect(JSON.stringify(failed)).not.toContain('secret=abc')
    expect(failed.probe?.message).toContain('权限不足')
    vi.mocked(f.runtime.probe).mockRejectedValueOnce(Object.assign(new Error('spawn failed'), { code: 'ENOENT' }))
    expect((await f.manager.probe({ id, expectedRevision: 1 })).probe?.message).toContain('未找到启动程序')
    await f.manager.dispose()
  })
  it('disposes a connection that finishes mounting after its Agent was closed', async () => {
    const f = fixture(), a = agent('a'), dispose = vi.fn(async () => {})
    let complete!: () => void
    vi.mocked(f.runtime.mount).mockImplementation(async () => { await new Promise<void>(resolve => { complete = resolve }); return { tools: () => [], dispose } })
    await f.manager.save({ configuration: config, expectedRevision: 0 })
    const mounting = f.manager.reconcile(a)
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'))
    await f.manager.disposeAgent(a); complete(); await mounting
    expect(dispose).toHaveBeenCalledOnce()
    await f.manager.reconcile(a)
    expect(f.runtime.mount).toHaveBeenCalledOnce()
    await f.manager.dispose()
  })
  it('writes private atomic configuration and rejects another local owner after restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'paimind-mcp-test-')); roots.push(root)
    const file = join(root, 'connections.json'), repo = new FileMcpConnectionRepository(file)
    const row = { configuration: config, owner: 'one', revision: 1, updatedAt: 10 }
    await repo.replace('one', [row]); expect(await repo.load('one')).toEqual([row])
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    expect(await readFile(file, 'utf8')).not.toContain('resolved-secret')
    await expect(repo.load('two')).rejects.toThrow('different account')
  })
  it('re-resolves credential references and revokes the old native client on rotation or removal', async () => {
    const f = fixture(), a = agent('a')
    let value = 'first-secret'
    f.runtime.credential = async () => { if (!value) throw new Error('Credential reference is unavailable'); return value }
    await f.manager.save({ configuration: { ...config, transport: 'stdio', command: 'node', args: [], cwd: '/tmp', envRefs: { TOKEN: 'MY_TOKEN' } }, expectedRevision: 0 })
    await f.manager.reconcile(a)
    value = 'rotated-secret'; await f.manager.reconcile(a)
    expect(f.runtime.mount).toHaveBeenCalledTimes(2)
    expect(f.disposers[0]).toHaveBeenCalledOnce()
    value = ''; await f.manager.reconcile(a)
    expect(f.disposers[1]).toHaveBeenCalledOnce()
    expect(f.manager.guard(f.names.get('a')!, a)).toBeDefined()
    expect(JSON.stringify(f.rows())).not.toContain('secret')
    await f.manager.dispose()
  })
})
