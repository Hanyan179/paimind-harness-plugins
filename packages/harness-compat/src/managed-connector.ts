import assert from 'node:assert/strict'
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ManagedHarnessExecutionDomain } from './managed-subprocess.js'
import { normalizeNativeConnectorConfiguration } from './connector-configuration.js'
import { openConnectorHttpEgress } from './connector-http-egress.js'
import type { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { createConnectorToolOrigin } from './connector-tool-origin.js'

/** Supplied from the exact installed native package at the existing Loader
 * normalization seam. No copied protocol, transport, tool registry or manager. */
interface NativeConnectorModule {
  readonly name: string
  readonly Config: unknown
  readonly inject: readonly string[]
  apply(context: Context, config: Record<string, unknown>): Promise<void>
}
const unavailable = () => new Error('Managed connector execution is unavailable')
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Change only the native stdio command's placement. The original MCP client
 * and SDK still own spawn, reconnect, cancellation, tool discovery and disposal.
 * HTTP uses an application-private fixed-destination network boundary.
 * This adapter neither activates an entry nor grants a member any tool. */
export function createManagedHarnessConnectorProvider(root: Context, native: NativeConnectorModule, domain: ManagedHarnessExecutionDomain, NativeTools?: typeof ToolRuntime) {
  assert.equal(root, root.root)
  assert.equal(native.name, 'mcp-client'); assert.equal(typeof native.Config, 'function')
  assert.deepEqual(native.inject, ['tools']); assert.equal(typeof native.apply, 'function')
  assert.ok(isAbsolute(domain.lookupCwd))
  const prepare = domain.prepare.bind(domain), workspaceRoot = domain.lookupCwd
  const origin = NativeTools && createConnectorToolOrigin(root, NativeTools)
  let active = true
  root.effect(() => () => { active = false })
  // An async function is essential: Cordis treats an ordinary prototype-bearing
  // function as a constructor and would not await the native startup promise.
  const apply = async (context: Context, raw: Record<string, unknown>) => {
    if (!active || context.root !== root) throw unavailable()
    let live = true
    context.effect(() => () => { live = false })
    const current = () => { if (!active || !live) throw unavailable() }
    let config: Record<string, unknown>
    try { config = normalizeNativeConnectorConfiguration(raw) } catch { throw unavailable() }
    const invoke = (projected: Record<string, unknown>) => origin
      ? origin.run(context, config, () => native.apply(context, projected)) : native.apply(context, projected)
    if (config.transport === 'streamable-http') {
      let relay: Awaited<ReturnType<typeof openConnectorHttpEgress>> | undefined
      try {
        current()
        relay = await openConnectorHttpEgress({ url: config.url as string, headers: config.headers as Record<string, string> })
        current()
        const close = relay.close
        context.effect(() => close)
        await invoke(Object.freeze({ ...config, url: relay.url, headers: relay.headers }))
        current()
        return
      } catch { await relay?.close(); throw unavailable() }
    }
    try {
      current()
      const request = Object.freeze({ kind: 'process' as const, fileAccess: 'workspace-write' as const, workspaceRoot,
        argv: Object.freeze([config.command as string, ...config.args as string[]]), cwd: config.cwd as string,
        env: Object.freeze({ ...config.env as Record<string, string> }) })
      const launch = prepare(request)
      if (launch && typeof (launch as unknown as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(launch).catch(() => undefined); throw unavailable()
      }
      if (!launch || !Array.isArray(launch.argv) || !launch.argv.length
        || !launch.argv.every(v => typeof v === 'string' && !v.includes('\0'))
        || !isAbsolute(launch.argv[0]!) || typeof launch.cwd !== 'string' || !isAbsolute(launch.cwd) || launch.cwd.includes('\0')
        || !record(launch.env) || Object.entries(launch.env).some(([k,v]) => !/^[A-Za-z_][A-Za-z_0-9]*$/u.test(k)
          || v !== undefined && (typeof v !== 'string' || v.includes('\0')))) throw unavailable()
      const environment = Object.freeze({ ...launch.env })
      const projected = Object.freeze({ ...config, command: launch.argv[0], args: Object.freeze(launch.argv.slice(1)), cwd: launch.cwd,
        get env() {
          current()
          // RC.2 merges scrubbedParentEnv; SDK 1.30 then merges its defaults.
          // Tombstone ALL ambient keys on every native reconnect (including
          // keys added since startup). Only deployment-selected launcher env
          // survives; explicit connector env is already inside confined argv.
          return { ...Object.fromEntries(Object.keys(process.env).map(key => [key, undefined])), ...environment }
        } })
      await invoke(projected)
      current()
    } catch { throw unavailable() }
  }
  const provider = Object.freeze({ ...native, apply })
  return Object.freeze({
    select(plugin: unknown): unknown {
      if (!active) throw unavailable()
      if (origin && plugin === NativeTools) return origin.Tools
      return record(plugin) && plugin.apply === native.apply ? provider : plugin
    },
    assertReady() { if (!active) throw unavailable(); origin?.assertReady() },
  })
}
