// @vitest-environment node
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { boot } from '@deepseek-ai/dsh-app-boot'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime, type ToolExecutionInput } from '@deepseek-ai/dsh-tools'
import { createNativeConnectorConfiguration } from '../src/connector-configuration.js'
import { installManagedHarnessToolGuard } from '../src/managed-runtime.js'
import { createManagedToolGuard, MEMBER_TOOL_POLICY } from '../../../deploy/enterprise/worker/runtime/member-tool-policy.mjs'
import { httpPeer } from './connector-native-server.mjs'

const native = createRequire(createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json'))
const anchor = native.resolve('@deepseek-ai/dsh-mcp-client/package.json'), mcp = native('@deepseek-ai/dsh-mcp-client')
const closes: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const close of closes.splice(0).reverse()) await close() })
const signal = () => new AbortController().signal
const common = { serverName: 'local_test', toolCallTimeoutMs: 1000, failOnStartupError: true,
  reconnect: { enabled: false, initialDelayMs: 100, maxDelayMs: 1000, maxAttempts: 1 } }
const call = (message: string): ToolExecutionInput => ({ name: 'mcp__local_test__echo', callId: 'native-connector-test' as ToolExecutionInput['callId'], arguments: { message }, signal: signal() })
async function fixture(transport: 'stdio' | 'streamable-http', guarded: boolean) {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'paimind-mcp-native-'))), file = join(home, 'root.json')
  await writeFile(file, '[]', { mode: 0o600 })
  let config: Record<string, unknown>, calls: unknown[] | undefined
  if (transport === 'stdio') config = { ...common, transport, command: process.execPath,
    args: [fileURLToPath(new URL('./connector-native-server.mjs', import.meta.url)), anchor, 'stdio'], cwd: home, env: {} }
  else { const peer = await httpPeer(anchor, 'http'); closes.push(() => peer.close()); calls = peer.calls
    config = { ...common, transport, url: peer.url, headers: {} } }
  const root = await boot('connector-native-contract', file, []); closes.push(() => root.fiber.dispose())
  const guard = guarded ? installManagedHarnessToolGuard(root, createManagedToolGuard({ role: 'member', policy: MEMBER_TOOL_POLICY })) : undefined
  await root.plugin(SystemPrompt, {}); await root.plugin(ToolRuntime, {}); if (guard) await vi.waitFor(() => guard.assertReady())
  const owner = await createNativeConnectorConfiguration(root, join(home, '.enterprise-connectors'))
  const saved = await owner.configure({ kind: 'upsert', entryId: 'local-test', configuration: config, expectedRevision: owner.read(signal()).revision }, signal())
  expect(saved.outcome).toBe('saved-disabled')
  expect(root.tools.get(call('').name)).toBeUndefined()
  const [record] = JSON.parse(await readFile(join(home, '.enterprise-connectors/cordis.json'), 'utf8'))
  // Deliberate isolated diagnostic mount, not a managed-cell activation API.
  // Neither the dormant original entry nor its persisted disabled flag changes.
  const parsed = mcp.Config(record.config)
  const fiber = await root.plugin(mcp, parsed)
  expect(fiber.state).toBe(2)
  return { root, owner, fiber, calls, home }
}

describe('selected original MCP provider contract, not enterprise activation or Browser E2E', () => {
  it('pins the provider version and proves zero attempts is rejected even when reconnect is off', () => {
    expect(native('@deepseek-ai/dsh-mcp-client/package.json').version).toBe('0.1.1-rc.2')
    const config = { ...common, transport: 'streamable-http', url: 'http://127.0.0.1:1/mcp', headers: {} }
    expect(() => mcp.Config(config)).not.toThrow()
    for (const enabled of [false, true]) expect(() => mcp.Config({ ...config, reconnect: { ...common.reconnect, enabled, maxAttempts: 0 } })).toThrow()
  })
  it.each(['stdio','streamable-http'] as const)('uses stored %s configuration in the real native handshake, tool dispatch and awaited disposal', async transport => {
    const f = await fixture(transport, false)
    const result = await f.root.tools.execute(call('contract-proof'))
    expect(result.isError).toBe(false)
    expect(JSON.stringify(result.value)).toContain((transport === 'stdio' ? 'stdio' : 'http') + ':contract-proof')
    if (f.calls) expect(f.calls).toEqual([{ name: 'echo', arguments: { message: 'contract-proof' } }])
    await f.fiber.dispose()
    expect(f.root.tools.get(call('').name)).toBeUndefined()
    expect((await f.root.tools.execute(call('after-dispose'))).isError).toBe(true)
    expect(f.owner.read(signal()).entries[0]?.enabled).toBe(false)
  })
  it.each(['stdio','streamable-http'] as const)('retains the member floor for a real registered %s tool; a successful connection is not a grant', async transport => {
    const f = await fixture(transport, true)
    const request = { ...call('must-not-run'), agent: { id: 'native-agent', session: { id: 'native-session', events: [] } } as ToolExecutionInput['agent'] }
    const result = await f.root.tools.execute(request)
    expect(result.isError).toBe(true); expect(JSON.stringify(result)).toContain('当前账户未获授权使用此工具')
    if (f.calls) expect(f.calls).toHaveLength(0)
    expect(f.owner.read(signal()).entries[0]?.enabled).toBe(false)
  })
})
