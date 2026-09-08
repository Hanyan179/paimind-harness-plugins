import { describe, expect, it } from 'vitest'
import { PAIMIND_NOTIFICATION_REMOTE_DESCRIPTORS, TYPERT_REMOTE } from '../src/remote.ts'
import { TYPERT } from '../src/typert.ts'

describe('FP12 strict Remote contract', () => {
  it('publishes one shared strict descriptor set to Host and Client', () => {
    expect(TYPERT.package).toBe('@hansen/notifications')
    expect(TYPERT.face).toBe('host')
    expect(TYPERT.invocations).toBe(PAIMIND_NOTIFICATION_REMOTE_DESCRIPTORS)
    expect(TYPERT_REMOTE.descriptors).toBe(PAIMIND_NOTIFICATION_REMOTE_DESCRIPTORS)
    expect(PAIMIND_NOTIFICATION_REMOTE_DESCRIPTORS.map(item => item.method)).toEqual([
      'list', 'markRead', 'markAllRead',
    ])
    expect(PAIMIND_NOTIFICATION_REMOTE_DESCRIPTORS.every(item => item.result.mode === 'strict')).toBe(true)
  })

  it('rejects an unsafe notification value at the generated-wire boundary', () => {
    const list = PAIMIND_NOTIFICATION_REMOTE_DESCRIPTORS[0]
    expect(() => list?.result.schema.parse({
      items: [{
        id: 'bad id', source: { id: 'p', nameZh: 'P', nameEn: 'P' }, title: 'x', level: 'info',
        createdAt: 1, version: 'v', target: { kind: 'external', url: 'http://unsafe.test' },
      }],
    })).toThrow()
  })
})
