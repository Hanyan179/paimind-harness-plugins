// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { McpConnectionManager } from '../src/manager.js'
import type { McpConnection } from '../src/contract.js'

// Regression: each pending disable owns its own synchronous call block.
it('keeps calls blocked while a second disable is pending after a stale concurrent disable fails', async () => {
  let rows: McpConnection[] = [], pause = false, release!: () => void, entered = false
  const id = 'e'.repeat(32), agent = { id: 'race', session: { id: 'race', header: {} }, ctx: {} }
  let toolName = ''
  const manager = new McpConnectionManager({ load: async () => rows, replace: async (_, next) => {
    if (pause) { entered = true; await new Promise<void>(resolve => { release = resolve }) }
    rows = [...next]
  } }, { currentOwner: () => 'test' }, {
    preset: () => 'test', credential: async () => '', probe: async () => [],
    mount: async (_, config) => { toolName = `mcp__${config.serverName}__echo_probe`; return { tools: () => [{ name: toolName, description: 'generic' }], dispose: async () => {} } },
  }, () => ({ connectionIdsForPreset: async () => [id], listProfiles: async () => ({ profiles: [] }) }))
  await manager.save({ expectedRevision: 0, configuration: { id, name: 'Generic', category: 'other', enabled: true, transport: 'stdio', command: 'fixture', args: [], cwd: '/tmp', envRefs: {}, timeoutMs: 5000 } })
  await manager.reconcile(agent)
  await manager.save({ expectedRevision: 1, configuration: { ...rows[0]!.configuration, name: 'Updated in another tab' } })
  pause = true
  const stale = manager.setEnabled({ id, expectedRevision: 1, enabled: false }).catch(() => {})
  const valid = manager.setEnabled({ id, expectedRevision: 2, enabled: false })
  await stale
  await vi.waitFor(() => expect(entered).toBe(true))
  const denialDuringPendingDisable = manager.guard(toolName, agent)
  release(); await valid; await manager.dispose()
  console.info('REVIEW_EVIDENCE', JSON.stringify({ pendingValidDisable: entered, staleDisableSettled: true, guardDenied: denialDuringPendingDisable !== undefined }))
  expect(denialDuringPendingDisable).toBeDefined()
})
