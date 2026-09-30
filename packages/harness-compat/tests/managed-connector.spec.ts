// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createManagedHarnessConnectorProvider } from '../src/managed-connector.js'
import type { ManagedHarnessExecutionDomain } from '../src/managed-subprocess.js'

const roots: Context[] = []
afterEach(async () => { vi.unstubAllEnvs(); for (const root of roots.splice(0).reverse()) await root.fiber.dispose() })
const rootContext = () => { const root = new Context(); roots.push(root); return root }
const config = () => ({ transport: 'stdio', serverName: 'approved_name', command: '/inside/command', args: ['one', ''], cwd: '/workspace/member', env: { EXPLICIT: 'test-value' },
  toolCallTimeoutMs: 1000, failOnStartupError: true, reconnect: { enabled: false, initialDelayMs: 100, maxDelayMs: 1000, maxAttempts: 1 } })
function fixture(prepare?: ManagedHarnessExecutionDomain['prepare']) {
  const root = rootContext(), native = { name: 'mcp-client', Config: (v: unknown) => v, inject: ['tools'], apply: vi.fn(async (_ctx: Context, _config: Record<string, unknown>) => {}) }
  const project = vi.fn(prepare ?? (request => ({ argv: ['/deployment/launcher', ...request.argv], cwd: '/', env: { PATH: '/deployment/bin' } })))
  const owner = createManagedHarnessConnectorProvider(root, native, { nodeExecutable: '/inside/node', moduleAnchor: '/inside/package.json', lookupCwd: '/workspace/member', prepare: project })
  const provider = owner.select(native) as typeof native
  return { root, native, project, owner, provider }
}
describe('application-scoped native MCP command placement, not authorization', () => {
  it('keeps native schema/services and async startup; only the exact original provider is selected', async () => {
    const f = fixture(), raw = config(), child = f.root.extend()
    expect(f.provider.Config).toBe(f.native.Config); expect(f.provider.inject).toBe(f.native.inject)
    expect(f.provider.apply.constructor.name).toBe('AsyncFunction')
    const foreign = { name: 'mcp-client', apply: async () => {} }
    expect(f.owner.select(foreign)).toBe(foreign)
    expect(f.owner.select({ ...f.native })).toBe(f.provider)
    await f.provider.apply(child, raw)
    expect(f.project).toHaveBeenCalledExactlyOnceWith({ kind: 'process', fileAccess: 'workspace-write', workspaceRoot: '/workspace/member',
      argv: ['/inside/command', 'one', ''], cwd: raw.cwd, env: raw.env })
    const [ctx, placed] = f.native.apply.mock.calls[0]!
    expect(ctx).toBe(child); expect(placed).toMatchObject({ command: '/deployment/launcher', args: ['/inside/command', 'one', ''], cwd: '/', serverName: raw.serverName, reconnect: raw.reconnect })
    expect(raw).toEqual(config()); expect(Object.isFrozen(placed)).toBe(true)
    expect(Object.isFrozen(f.project.mock.calls[0]![0].argv)).toBe(true)
  })
  it('tombstones ambient environment for every reconnect, including late additions, without mutating the parent or saved config', async () => {
    const f = fixture(); vi.stubEnv('PAIMIND_AMBIENT_DIAGNOSTIC', 'parent-only')
    await f.provider.apply(f.root.extend(), config())
    const placed = f.native.apply.mock.calls[0]![1]
    expect(placed.env).toMatchObject({ PAIMIND_AMBIENT_DIAGNOSTIC: undefined, PATH: '/deployment/bin' })
    vi.stubEnv('PAIMIND_LATE_DIAGNOSTIC', 'also-parent-only')
    expect(placed.env).toMatchObject({ PAIMIND_LATE_DIAGNOSTIC: undefined })
    expect(process.env.PAIMIND_LATE_DIAGNOSTIC).toBe('also-parent-only')
    expect((placed.env as Record<string, unknown>).EXPLICIT).toBeUndefined()
  })
  it('rejects private HTTP before the native connection owner or placement callback runs', async () => {
    const f = fixture(), { command, args, cwd, env, ...base } = config()
    await expect(f.provider.apply(f.root.extend(), { ...base, transport: 'streamable-http', url: 'http://127.0.0.1:3080/mcp', headers: {} })).rejects.toThrow('unavailable')
    expect(f.project).not.toHaveBeenCalled(); expect(f.native.apply).not.toHaveBeenCalled()
  })
  it('projects only the network endpoint and private capability; disposal closes the relay and leaves saved credentials intact', async () => {
    const f = fixture(), { command, args, cwd, env, ...base } = config()
    const raw = { ...base, transport: 'streamable-http', url: 'https://example.invalid/mcp', headers: { Authorization: 'private-upstream-value' } }
    await f.provider.apply(f.root.extend(), raw)
    const placed = f.native.apply.mock.calls[0]![1]
    expect(placed.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/u)
    expect(placed.headers).not.toEqual(raw.headers); expect(raw.headers.Authorization).toBe('private-upstream-value')
    expect(f.project).not.toHaveBeenCalled()
    expect((await fetch(placed.url as string)).status).toBe(403)
    await f.root.fiber.dispose()
    await expect(fetch(placed.url as string)).rejects.toThrow()
  })
  it('joins HTTP relay cleanup when native startup fails without disclosing the native error', async () => {
    const f = fixture(), { command, args, cwd, env, ...base } = config()
    f.native.apply.mockRejectedValueOnce(Error('SYNTHETIC_PRIVATE_STARTUP_DETAIL'))
    await expect(f.provider.apply(f.root.extend(), { ...base, transport: 'streamable-http', url: 'https://example.invalid/mcp', headers: {} })).rejects.toThrow('Managed connector execution is unavailable')
    const placed = f.native.apply.mock.calls[0]![1]
    await expect(fetch(placed.url as string, { headers: placed.headers as Record<string,string> })).rejects.toThrow()
    f.owner.assertReady()
  })
  it.each([
    ['async allow', async () => ({ argv: ['/escape'], cwd: '/', env: {} })],
    ['async reject', async () => { throw Error('PRIVATE_PROJECTION_DETAIL') }],
    ['relative command', () => ({ argv: ['escape'], cwd: '/', env: {} })],
    ['relative cwd', () => ({ argv: ['/escape'], cwd: '.', env: {} })],
    ['null argv', () => ({ argv: ['/escape', '\0'], cwd: '/', env: {} })],
    ['missing environment', () => ({ argv: ['/escape'], cwd: '/' })],
    ['invalid environment', () => ({ argv: ['/escape'], cwd: '/', env: { ENV: 4 } })],
    ['throw', () => { throw Error('PRIVATE_PROJECTION_DETAIL') }],
  ])('fails closed for %s without disclosing private projection details', async (_name, project) => {
    const f = fixture(project as ManagedHarnessExecutionDomain['prepare'])
    await expect(f.provider.apply(f.root.extend(), config())).rejects.toThrow('Managed connector execution is unavailable')
    expect(f.native.apply).not.toHaveBeenCalled()
  })
  it('does not let a legacy dormant zero bypass the new-write execution contract', async () => {
    const f = fixture(), raw = config(); raw.reconnect.maxAttempts = 0
    await expect(f.provider.apply(f.root.extend(), raw)).rejects.toThrow('unavailable')
    expect(f.project).not.toHaveBeenCalled(); expect(f.native.apply).not.toHaveBeenCalled()
  })
  it('refuses another root and retained provider/config references after disposal', async () => {
    const f = fixture(), other = rootContext()
    await expect(f.provider.apply(other, config())).rejects.toThrow('unavailable')
    await f.provider.apply(f.root.extend(), config())
    const placed = f.native.apply.mock.calls[0]![1]
    await f.root.fiber.dispose()
    expect(() => placed.env).toThrow('unavailable'); expect(() => f.owner.assertReady()).toThrow('unavailable')
    expect(() => f.owner.select(f.native)).toThrow('unavailable')
    await expect(f.provider.apply(other, config())).rejects.toThrow('unavailable')
  })
})
