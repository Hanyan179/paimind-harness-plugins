import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installHarnessScheduledSessionMarkers } from '../src/client-surface.ts'

function row(title: string): HTMLElement {
  const element = document.createElement('div')
  element.setAttribute('role', 'treeitem')
  element.setAttribute('aria-selected', 'false')
  element.innerHTML = `<span>avatar</span><span>${title}</span><span style="opacity:.7">2h</span>`
  document.body.append(element)
  return element
}

function source(
  byId: Readonly<Record<string, { readonly id: string; readonly title: string }>>,
  scheduled: readonly string[],
) {
  const unsubscribe = vi.fn()
  return {
    value: {
      getSessionSnapshot: () => ({ ids: Object.keys(byId), byId }),
      getScheduledSessionIds: () => new Set(scheduled),
      subscribe: vi.fn(() => unsubscribe),
    },
    unsubscribe,
  }
}

describe('Harness scheduled Session markers', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('replaces native relative time with a clock and restores the row on unload', () => {
    const task = row('每日项目简报')
    const ordinary = row('普通对话')
    const fixture = source({
      scheduled: { id: 'scheduled', title: '每日项目简报' },
      ordinary: { id: 'ordinary', title: '普通对话' },
    }, ['scheduled'])
    const dispose = installHarnessScheduledSessionMarkers(fixture.value, document)

    expect(task.dataset.paimindScheduledSession).toBe('row')
    expect(task.querySelector('[data-paimind-scheduled-session="clock"]')).toHaveAttribute('aria-label', '已安排任务')
    expect(task.querySelector<HTMLElement>('[data-paimind-scheduled-native-time]')?.style.display).toBe('none')
    expect(ordinary.dataset.paimindScheduledSession).toBeUndefined()

    dispose()
    expect(task.dataset.paimindScheduledSession).toBeUndefined()
    expect(task.querySelector('[data-paimind-scheduled-session="clock"]')).toBeNull()
    expect(task.querySelector<HTMLElement>('span[style]')?.style.display).not.toBe('none')
    expect(fixture.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('fails closed when one visible title maps to scheduled and ordinary canonical Sessions', () => {
    const first = row('重复标题')
    const second = row('重复标题')
    const fixture = source({
      scheduled: { id: 'scheduled', title: '重复标题' },
      ordinary: { id: 'ordinary', title: '重复标题' },
    }, ['scheduled'])
    const dispose = installHarnessScheduledSessionMarkers(fixture.value, document)
    expect(first.dataset.paimindScheduledSession).toBeUndefined()
    expect(second.dataset.paimindScheduledSession).toBeUndefined()
    expect(document.querySelector('[data-paimind-scheduled-session="clock"]')).toBeNull()
    dispose()
  })

  it('marks every duplicate row only when every canonical Session with that title is scheduled', () => {
    const first = row('每日采集')
    const second = row('每日采集')
    const fixture = source({
      one: { id: 'one', title: '每日采集' },
      two: { id: 'two', title: '每日采集' },
    }, ['one', 'two'])
    const dispose = installHarnessScheduledSessionMarkers(fixture.value, document)
    expect(first.dataset.paimindScheduledSession).toBe('row')
    expect(second.dataset.paimindScheduledSession).toBe('row')
    expect(document.querySelectorAll('[data-paimind-scheduled-session="clock"]')).toHaveLength(2)
    dispose()
  })
})
