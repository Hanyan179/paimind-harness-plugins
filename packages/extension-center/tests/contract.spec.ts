import { describe, expect, it } from 'vitest'
import { definePaimindExtension } from '@hansen/contracts'
import { projectExtensionTechnicalState } from '../src/index.js'

const descriptor = definePaimindExtension({
  id: 'paimind:test', packageName: '@hansen/test', category: 'developer',
  nameZh: '测试', nameEn: 'Test', descriptionZh: '测试扩展。', descriptionEn: 'Test extension.',
  surface: 'settings', maturity: 'available',
})

describe('Extension Center product and technical truth boundary', () => {
  it('freezes validated product metadata', () => {
    expect(Object.isFrozen(descriptor)).toBe(true)
    expect(Object.isFrozen(descriptor.permissions)).toBe(true)
    expect(() => definePaimindExtension({ ...descriptor, id: 'invalid' as `paimind:${string}` })).toThrow('invalid PAIMind extension id')
  })

  it('joins only the exact Harness module id and preserves independent lifecycle state', () => {
    const projection = projectExtensionTechnicalState(descriptor, { entries: [
      { entryId: 'child', moduleName: '@hansen/test/invariant', enabled: true, fiberPhase: 'failed' },
      { entryId: 'root', moduleName: '@hansen/test', enabled: true, fiberPhase: 'active' },
    ] })
    expect(projection.technicalState).toBe('active')
    expect(projection.entries.map(entry => entry.entryId)).toEqual(['root'])
  })

  it.each([
    [{ enabled: true, fiberPhase: 'failed' }, 'failed'],
    [{ enabled: true, fiberPhase: 'loading' }, 'loading'],
    [{ enabled: false, fiberPhase: null }, 'disabled'],
    [{ enabled: true, fiberPhase: null }, 'unobserved'],
  ] as const)('projects native inventory state %#', (entry, expected) => {
    expect(projectExtensionTechnicalState(descriptor, { entries: [{
      entryId: 'root', moduleName: '@hansen/test', ...entry,
    }] }).technicalState).toBe(expected)
  })
})
