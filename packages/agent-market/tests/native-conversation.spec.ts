import { expect, it, vi } from 'vitest'
import { AgentCenterRuntime } from '../src/client/index.js'

it('creates the selected native Agent in the current Workspace before product binding, without submitting a turn', async () => {
  let current = 'source'
  const create = vi.fn(async (_input: unknown, _signal?: AbortSignal) => ({
    result: {
      ok: true,
      value: { sessionId: 'native-new', agentPreset: 'mine' },
    },
  }))
  const setDraft = vi.fn(),
    bindSession = vi.fn(async () => ({ ok: true, value: {} }))
  const startSession = vi.fn(),
    select = vi.fn(),
    prompt = vi.fn()
  const sessions = {
    list: {
      getSnapshot: () => ({
        current,
        byId: { source: { id: 'source', blank: false } },
      }),
      subscribe: () => () => {},
    },
    open: vi.fn((id: string) => {
      current = id
    }),
    binding: () => ({
      ctx: {},
      session: {
        getSnapshot: () => ({ running: false }),
        subscribe: () => () => {},
        prompt,
      },
    }),
  }
  const remote = {
    listAudit: async () => ({ ok: true, value: { migrations: [] } }),
    migrationPlan: async () => ({ ok: true, value: null }),
    bindSession,
  }
  const runtime = new AgentCenterRuntime(
    { select } as never,
    remote as never,
    sessions as never,
    {
      startSession,
      list: {
        getSnapshot: () => ({
          recentWorkspaceId: 'unrelated',
          items: [{ workspaceId: 'actual', sessionIds: ['source'] }],
        }),
      },
    } as never,
    { input: { for: () => ({ setDraft }) } } as never,
    { create } as never,
  )
  try {
    await expect(
      runtime.start('mine', {
        agentId: 'agent-1',
        configVersion: 'v1',
        instructions: '',
      } as never),
    ).resolves.toBe('native-new')
    expect(create.mock.calls[0]?.[0]).toEqual({
      workspaceId: 'actual',
      agentPreset: 'mine',
    })
    expect(bindSession).toHaveBeenCalledWith({
      sessionId: 'native-new',
      agentId: 'agent-1',
      presetId: 'mine',
      configVersion: 'v1',
      purpose: 'conversation',
    })
    expect(startSession).not.toHaveBeenCalled()
    expect(select).not.toHaveBeenCalled()
    expect(prompt).not.toHaveBeenCalled()
    expect(setDraft).toHaveBeenCalledWith('')
  } finally {
    runtime.dispose()
  }
})
