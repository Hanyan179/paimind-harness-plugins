import { describe, expect, it, vi } from 'vitest'
import type {
  HarnessObservableSnapshot, HarnessSessionListSnapshot, HarnessWorkspaceListSnapshot,
} from '@paimind/harness-compat'
import { WorkspaceProjectBridge } from '../src/index.js'

function observable<T>(initial: T): HarnessObservableSnapshot<T> & { set(value: T): void; listeners(): number } {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set(next) {
      value = next
      for (const listener of [...listeners]) listener()
    },
    listeners: () => listeners.size,
  }
}

const workspaceState = (title = 'One'): HarnessWorkspaceListSnapshot => ({
  items: [{
    workspaceId: 'ws-1', path: '/work/one', title, sessionIds: ['s-1'],
    createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-14T04:00:00.000Z',
  }],
  archivedSessionIds: [], state: 'idle', error: null, baselinesReady: true,
})
const sessionState = (current: string | null = 's-1'): HarnessSessionListSnapshot => ({
  current: current ?? undefined, byId: { 's-1': { id: 's-1', running: false } },
})

describe('WorkspaceProjectBridge', () => {
  it('caches one snapshot and follows both native feeds', () => {
    const workspaceList = observable(workspaceState())
    const sessionList = observable(sessionState())
    const bridge = new WorkspaceProjectBridge({
      list: workspaceList, startSession: vi.fn(), openPath: vi.fn(),
    }, { list: sessionList })
    const listener = vi.fn()
    bridge.subscribe(listener)
    const first = bridge.getSnapshot()
    expect(bridge.getSnapshot()).toBe(first)

    workspaceList.set(workspaceState('Renamed'))
    expect(listener).toHaveBeenCalledTimes(1)
    expect(bridge.getSnapshot().currentProject?.title).toBe('Renamed')
    sessionList.set(sessionState(null))
    expect(listener).toHaveBeenCalledTimes(2)
    expect(bridge.getSnapshot().currentProject).toBeNull()
    bridge.dispose()
  })

  it('delegates actions only for an existing native Workspace', async () => {
    const startSession = vi.fn()
    const openPath = vi.fn().mockResolvedValue(undefined)
    const bridge = new WorkspaceProjectBridge({
      list: observable(workspaceState()), startSession, openPath,
    }, { list: observable(sessionState()) })

    bridge.startSession('ws-1')
    await bridge.openWorkspace('ws-1')
    expect(startSession).toHaveBeenCalledWith('ws-1')
    expect(openPath).toHaveBeenCalledWith('/work/one')
    expect(() => bridge.startSession('missing')).toThrow('unknown Harness Workspace')
    await expect(bridge.openWorkspace('missing')).rejects.toThrow('unknown Harness Workspace')
    bridge.dispose()
  })

  it('unsubscribes from both upstream stores on disposal', () => {
    const workspaceList = observable(workspaceState())
    const sessionList = observable(sessionState())
    const bridge = new WorkspaceProjectBridge({
      list: workspaceList, startSession: vi.fn(), openPath: vi.fn(),
    }, { list: sessionList })
    expect([workspaceList.listeners(), sessionList.listeners()]).toEqual([1, 1])
    bridge.dispose()
    bridge.dispose()
    expect([workspaceList.listeners(), sessionList.listeners()]).toEqual([0, 0])
  })
})
