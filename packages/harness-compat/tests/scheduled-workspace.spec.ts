// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { createPaimindScheduledHarnessAgent } from '../src/host.js'
it('attaches a scheduled session to the native workspace matching its actual header before returning it', async () => {
  const attach = vi.fn(async () => {}), other = vi.fn(async () => {}), dispose = vi.fn(async () => {})
  const handle = { agent: { id: 's', session: { id: 's', header: { cwd: '/actual' }, events: [] }, followup() {}, async whenIdle() {} }, dispose }
  const agents = { create: vi.fn(async () => handle) }, presets = { resolve: async () => ({ id: 'standard' }), mount: async () => {} }
  await createPaimindScheduledHarnessAgent(agents, presets, { sessionId: 's', cwd: '/requested', workspaceRegistry: { list: () => [{ path: '/actual', attachSession: attach }, { path: '/requested', attachSession: other }] } })
  expect(attach).toHaveBeenCalledWith('s'); expect(other).not.toHaveBeenCalled(); expect(dispose).not.toHaveBeenCalled()
  attach.mockRejectedValueOnce(new Error('native ownership refused'))
  await expect(createPaimindScheduledHarnessAgent(agents, presets, { sessionId: 's', workspaceRegistry: { list: () => [{ path: '/actual', attachSession: attach }] } })).rejects.toThrow('native ownership refused')
  expect(dispose).toHaveBeenCalledOnce()
})
it('applies only an explicitly selected native permission preset and fails closed when unavailable', async () => {
  const session = { id: 's', header: {}, events: [] }
  const dispose = vi.fn(async () => {})
  const handle = { agent: { id: 's', session, followup() {}, async whenIdle() {} }, dispose }
  const agents = { create: vi.fn(async () => handle) }
  const permissionPresets = { set: vi.fn() }
  await createPaimindScheduledHarnessAgent(agents, undefined, { sessionId: 's', permissionPresets })
  expect(permissionPresets.set).not.toHaveBeenCalled()
  await createPaimindScheduledHarnessAgent(agents, undefined, { sessionId: 's', permissionPresets, permissionPreset: 'danger-full-access' })
  expect(permissionPresets.set).toHaveBeenCalledExactlyOnceWith(session, 'danger-full-access')
  agents.create.mockClear()
  await expect(createPaimindScheduledHarnessAgent(agents, undefined, { sessionId: 's', permissionPreset: 'danger-full-access' })).rejects.toThrow('Native permission service')
  expect(agents.create).not.toHaveBeenCalled()
  permissionPresets.set.mockImplementationOnce(() => { throw new Error('native permission refused') })
  await expect(createPaimindScheduledHarnessAgent(agents, undefined, { sessionId: 's', permissionPresets, permissionPreset: 'danger-full-access' })).rejects.toThrow('native permission refused')
  expect(dispose).toHaveBeenCalledOnce()
})
