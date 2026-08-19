import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PaimindProductSurfaceController,
  installPaimindProductSurfaceInteraction,
} from '../src/client-surface.js'

afterEach(() => {
  document.body.innerHTML = ''
  document.body.style.overflow = ''
  vi.useRealTimers()
})

describe('PAIMind product surface controller', () => {
  it('keeps independently installed Agent and Skill surfaces mutually exclusive', () => {
    const agents = new PaimindProductSurfaceController('agent-center', window, document)
    const skills = new PaimindProductSurfaceController('skill-center', window, document)

    agents.open()
    expect(agents.getSnapshot().open).toBe(true)
    expect(skills.getSnapshot().open).toBe(false)

    skills.open()
    expect(agents.getSnapshot().open).toBe(false)
    expect(skills.getSnapshot().open).toBe(true)

    agents.dispose()
    skills.dispose()
  })

  it('restores focus to the invoking sidebar action on close', () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<button data-paimind-product-trigger="agent-center">Agent Center</button>'
    const trigger = document.querySelector<HTMLButtonElement>('button')!
    const controller = new PaimindProductSurfaceController('agent-center', window, document)

    controller.open(trigger)
    controller.close()
    vi.runAllTimers()

    expect(document.activeElement).toBe(trigger)
    controller.dispose()
  })
})

describe('PAIMind product surface interaction', () => {
  it('isolates scroll, contains focus, handles Escape, and cleans up', () => {
    vi.useFakeTimers()
    document.body.style.overflow = 'auto'
    const trigger = document.createElement('button')
    trigger.dataset.paimindProductTrigger = 'skill-center'
    document.body.append(trigger)
    const root = document.createElement('div')
    root.innerHTML = '<button data-paimind-product-initial-focus>First</button><button>Last</button>'
    document.body.append(root)
    const first = root.querySelectorAll('button')[0]!
    const last = root.querySelectorAll('button')[1]!
    const controller = new PaimindProductSurfaceController('skill-center', window, document)
    controller.open(trigger)

    const dispose = installPaimindProductSurfaceInteraction(root, controller, document)
    expect(document.body.style.overflow).toBe('hidden')
    expect(document.activeElement).toBe(first)

    last.focus()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    expect(document.activeElement).toBe(first)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    vi.runAllTimers()
    expect(controller.getSnapshot().open).toBe(false)
    expect(document.activeElement).toBe(trigger)

    dispose()
    expect(document.body.style.overflow).toBe('auto')
    controller.dispose()
  })
})
