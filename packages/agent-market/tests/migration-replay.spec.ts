import { expect, it, vi } from 'vitest'
import { AgentCenterRuntime } from '../src/client/index.js'

function fixture(deferPlan = false, sourceBlank = false) {
  const listeners = new Set<() => void>()
  const rows: Record<string, { id: string; blank: boolean; agentPreset: string; running: boolean }> = {
    source: { id: 'source', blank: sourceBlank, agentPreset: 'mine', running: false },
  }
  let current = 'source', selected = 'mine', resolvePlan!: (value: unknown) => void
  const prompt = vi.fn(), setDraft = vi.fn()
  const plan = { sourceSessionId: 'source', agentId: 'mine', presetId: 'mine', fromVersion: 'v1-a', toVersion: 'v2-a', summary: 'Past user request: execute echo_probe exactly once.' }
  const migrationPlan = vi.fn(async ({ sourceSessionId }: { sourceSessionId: string }) => sourceSessionId !== 'source'
    ? { ok: true, value: null } : deferPlan ? await new Promise(resolve => { resolvePlan = resolve }) : { ok: true, value: plan })
  const recordMigration = vi.fn(async () => ({ ok: true, value: {} }))
  const sessions = {
    list: { getSnapshot: () => ({ current, byId: rows }), subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } } },
    binding: (id: string) => ({ ctx: { id }, session: { prompt, getSnapshot: () => ({ running: rows[id]?.running ?? false, chat: null }), subscribe: () => () => {} } }),
    open: vi.fn((id: string) => { current = id }),
  }
  const workspaces = { startSession: vi.fn(() => { current = 'target'; rows.target = { id: 'target', blank: true, agentPreset: 'standard', running: false }; listeners.forEach(listener => { listener() }) }) }
  const seat = { getSnapshot: () => ({ current: selected, error: null, busy: false }), select: vi.fn(async (preset: string) => { selected = preset; rows[current]!.agentPreset = preset }) }
  const runtime = new AgentCenterRuntime(seat as never, {
    listAudit: vi.fn(async () => ({ ok: true, value: { migrations: [] } })), migrationPlan, recordMigration,
  } as never, sessions as never, workspaces as never, { input: { for: () => ({ setDraft }) } })
  return { runtime, rows, prompt, setDraft, recordMigration, workspaces, migrationPlan, plan, resolve: () => { resolvePlan({ ok: true, value: plan }) } }
}

it('prepares an unsent migration draft without replaying historical requests in another native Session', async () => {
  const f = fixture()
  try {
    await vi.waitFor(() => expect(f.recordMigration).toHaveBeenCalledOnce())
    expect(f.workspaces.startSession).toHaveBeenCalledOnce()
    expect(f.setDraft).toHaveBeenCalledExactlyOnceWith(f.plan.summary)
    expect(f.prompt).not.toHaveBeenCalled()
    expect(f.runtime.getSnapshot().notice).toContain('尚未发送')
  } finally { f.runtime.dispose() }
})

it('does not navigate away when the user starts a turn while a migration plan is being read', async () => {
  const f = fixture(true)
  try {
    await vi.waitFor(() => expect(f.migrationPlan).toHaveBeenCalledOnce())
    f.rows.source!.running = true
    f.resolve()
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(f.workspaces.startSession).not.toHaveBeenCalled()
    expect(f.setDraft).not.toHaveBeenCalled()
    expect(f.prompt).not.toHaveBeenCalled()
  } finally { f.runtime.dispose() }
})

it('does not reuse the source of an unsent continuation as its own migration target', async () => {
  const f = fixture(false, true)
  try {
    await vi.waitFor(() => expect(f.recordMigration).toHaveBeenCalledOnce())
    expect(f.workspaces.startSession).toHaveBeenCalledOnce()
    expect(f.recordMigration).toHaveBeenCalledWith(expect.objectContaining({ sourceSessionId: 'source', targetSessionId: 'target' }))
    expect(f.prompt).not.toHaveBeenCalled()
  } finally { f.runtime.dispose() }
})
