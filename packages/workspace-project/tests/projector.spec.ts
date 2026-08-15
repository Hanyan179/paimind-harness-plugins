import { describe, expect, it } from 'vitest'
import type {
  HarnessSessionListSnapshot, HarnessWorkspaceListSnapshot,
} from '@paimind/harness-compat'
import { projectWorkspaceSnapshot } from '../src/index.js'

const workspaces = (overrides: Partial<HarnessWorkspaceListSnapshot> = {}): HarnessWorkspaceListSnapshot => ({
  items: [{
    workspaceId: 'ws-1', path: '/work/one', title: 'One',
    sessionIds: ['s-1', 's-2'], createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-14T04:00:00.000Z',
  }],
  archivedSessionIds: ['s-2'], state: 'idle', error: null, baselinesReady: true,
  ...overrides,
})

const sessions = (current: string | null = 's-1'): HarnessSessionListSnapshot => ({
  current: current ?? undefined,
  ids: ['s-1', 's-2'],
  byId: {
    's-1': { id: 's-1', displayTitle: 'Alpha', cwd: '/work/one', running: false },
    's-2': { id: 's-2', displayTitle: 'Beta', cwd: '/work/one', running: false },
  },
})

describe('projectWorkspaceSnapshot', () => {
  it('projects native ids, counts and current membership without mutating inputs', () => {
    const native = workspaces()
    const before = JSON.stringify(native)
    const snapshot = projectWorkspaceSnapshot(native, sessions())

    expect(snapshot).toMatchObject({ state: 'ready', currentSessionId: 's-1', error: null })
    expect(snapshot.currentProject).toMatchObject({
      workspaceId: 'ws-1', path: '/work/one', title: 'One',
      visibleSessionCount: 1, archivedSessionCount: 1, totalSessionCount: 2,
    })
    expect(snapshot.projects[0]?.sessionIds).not.toBe(native.items[0]?.sessionIds)
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.projects[0])).toBe(true)
    expect(JSON.stringify(native)).toBe(before)
  })

  it('never claims an ungrouped session from a matching cwd', () => {
    const result = projectWorkspaceSnapshot(workspaces(), {
      current: 'unowned',
      byId: { unowned: { id: 'unowned', cwd: '/work/one', running: false } },
    })
    expect(result.currentProject).toBeNull()
  })

  it('exposes loading until native baselines are ready', () => {
    const result = projectWorkspaceSnapshot(
      workspaces({ baselinesReady: false, state: 'loading' }),
      sessions(null),
    )
    expect(result).toMatchObject({ state: 'loading', currentProject: null, error: null })
  })

  it('preserves native workspace failure without inventing projects', () => {
    const result = projectWorkspaceSnapshot(workspaces({
      items: [], baselinesReady: false, state: 'error', error: { message: 'registry denied' },
    }), sessions())
    expect(result).toMatchObject({ state: 'error', projects: [], currentProject: null, error: 'registry denied' })
  })
})
