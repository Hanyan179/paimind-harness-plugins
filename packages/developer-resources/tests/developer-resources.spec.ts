import { describe, expect, it } from 'vitest'
import { definePaimindExtension } from '@paimind/contracts'
import {
  PAIMIND_INTEGRATION_REFERENCES,
  paimindInventoryEntries,
  projectDeveloperSurface,
  summarizePaimindInventory,
} from '../src/index.js'

const snapshot = { entries: [
  { entryId: 'active', moduleName: '@paimind/active', enabled: true, fiberPhase: 'active' as const },
  { entryId: 'loading', moduleName: '@paimind/loading', enabled: true, fiberPhase: 'loading' as const },
  { entryId: 'pending', moduleName: '@paimind/pending', enabled: true, fiberPhase: 'pending' as const },
  { entryId: 'unloading', moduleName: '@paimind/unloading', enabled: true, fiberPhase: 'unloading' as const },
  { entryId: 'failed', moduleName: '@paimind/failed', enabled: true, fiberPhase: 'failed' as const },
  { entryId: 'disabled', moduleName: '@paimind/disabled', enabled: false, fiberPhase: null },
  { entryId: 'unobserved', moduleName: '@paimind/unobserved', enabled: true, fiberPhase: null },
  { entryId: 'native', moduleName: '@deepseek-ai/dsh-native', enabled: true, fiberPhase: 'active' as const },
] }

describe('Developer Resources truth boundary', () => {
  it('summarizes only exact PAIMind native inventory rows', () => {
    expect(paimindInventoryEntries(snapshot).map(entry => entry.entryId)).not.toContain('native')
    expect(summarizePaimindInventory(snapshot)).toEqual({
      total: 7, active: 1, loading: 3, failed: 1, disabled: 1, unobserved: 1,
    })
  })

  it('joins a surface by exact package id and preserves technical dimensions', () => {
    const descriptor = definePaimindExtension({
      id: 'paimind:active', packageName: '@paimind/active', category: 'developer',
      nameZh: '活动', nameEn: 'Active', descriptionZh: '活动。', descriptionEn: 'Active.',
      surface: 'settings', maturity: 'available',
    })
    expect(projectDeveloperSurface(descriptor, snapshot)).toMatchObject({
      technicalState: 'active', entries: [{ entryId: 'active' }],
    })
    expect(projectDeveloperSurface({ ...descriptor, packageName: '@paimind/missing' }, snapshot).technicalState).toBe('unavailable')
  })

  it('ships only real, uniquely identified bundled integration references', () => {
    expect(new Set(PAIMIND_INTEGRATION_REFERENCES.map(reference => reference.id)).size).toBe(PAIMIND_INTEGRATION_REFERENCES.length)
    expect(PAIMIND_INTEGRATION_REFERENCES.map(reference => reference.contract)).toEqual(expect.arrayContaining([
      'paimind.extension', 'paimindWorkspaceProject', 'conversation.session.header.actions',
      'paimindArtifactGenerators', 'paimind.tool-result/v1', 'paimind.artifacts', 'paimindSidebar', 'settings.section',
    ]))
  })
})
