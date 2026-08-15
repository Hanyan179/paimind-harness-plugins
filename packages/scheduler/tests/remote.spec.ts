import { describe, expect, it } from 'vitest'
import TYPERT_REMOTE, { PAIMIND_SCHEDULER_REMOTE_DESCRIPTORS } from '../src/remote.ts'
import TYPERT from '../src/typert.ts'

describe('platform Scheduler remote contract', () => {
  it('publishes strict task, schedule-control and test-run methods only', () => {
    expect(TYPERT_REMOTE.package).toBe('@paimind/platform-scheduler')
    expect(TYPERT.package).toBe('@paimind/platform-scheduler')
    expect(PAIMIND_SCHEDULER_REMOTE_DESCRIPTORS.map(item => item.method)).toEqual([
      'list', 'create', 'update', 'setEnabled', 'archive', 'runNow',
    ])
    expect(PAIMIND_SCHEDULER_REMOTE_DESCRIPTORS.every(item => item.result.mode === 'strict')).toBe(true)
  })
})
