import { describe, expect, it, vi } from 'vitest'
import type {
  HarnessSessionListSnapshot,
  HarnessWorkspaceListSnapshot,
  PaimindWorkspaceClientContext,
} from '@paimind/harness-compat'
import { createClientContextFixture } from '@paimind/testkit'
import { apply, inject } from '../src/client/index.js'

const workspaceState: HarnessWorkspaceListSnapshot = {
  items: [{
    workspaceId: 'ws-1', path: '/work/one', title: '产品工作区',
    sessionIds: ['s-1'], createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-14T04:00:00.000Z',
  }],
  archivedSessionIds: [], state: 'idle', error: null, baselinesReady: true,
}
const sessionState: HarnessSessionListSnapshot = {
  current: 's-1', ids: ['s-1'],
  byId: { 's-1': { id: 's-1', cwd: '/work/one', running: false } },
}

describe('FP04 headless Workspace adapter', () => {
  it('publishes only the native Workspace bridge and no visible slot or style', () => {
    const fixture = createClientContextFixture()
    const context: PaimindWorkspaceClientContext = {
      ...fixture.context,
      workspaces: {
        list: { getSnapshot: () => workspaceState, subscribe: () => () => {} },
        startSession: vi.fn(), openPath: vi.fn().mockResolvedValue(undefined),
      },
      sessions: { list: { getSnapshot: () => sessionState, subscribe: () => () => {} } },
    }
    apply(context)

    expect(inject).toEqual(['sessions', 'workspaces'])
    expect(fixture.services.has('paimindWorkspaceProject')).toBe(true)
    expect(fixture.slots).toHaveLength(0)
    expect(document.querySelector('style[data-paimind-plugin="@paimind/workspace-project"]')).toBeNull()
    fixture.disposeEffects()
    expect(fixture.services.has('paimindWorkspaceProject')).toBe(false)
  })
})
