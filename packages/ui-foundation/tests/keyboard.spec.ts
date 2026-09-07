import { afterEach, expect, it, vi } from 'vitest'
import { handlePaimindTabKey } from '../src/keyboard.js'

afterEach(() => { document.body.replaceChildren() })

it('wraps focus within the local tab list and skips unavailable and nested tabs', () => {
  document.body.innerHTML = '<div role="tablist"><button role="tab">First</button><button role="tab" disabled>Disabled</button><button role="tab" hidden>Hidden</button><button role="tab" aria-disabled="true">Unavailable</button><div role="tablist"><button role="tab">Nested</button></div><button role="tab">Last</button></div>'
  const tabs = document.querySelectorAll<HTMLButtonElement>('[role="tab"]')
  const first = tabs[0]!
  const last = tabs[5]!
  const activate = vi.fn()
  last.addEventListener('click', activate)
  const preventDefault = vi.fn()
  handlePaimindTabKey({ key: 'ArrowLeft', currentTarget: first, preventDefault })
  expect(document.activeElement).toBe(last)
  expect(activate).toHaveBeenCalledOnce()
  expect(preventDefault).toHaveBeenCalledOnce()
  handlePaimindTabKey({ key: 'Home', currentTarget: last, preventDefault })
  expect(document.activeElement).toBe(first)
  handlePaimindTabKey({ key: 'End', currentTarget: first, preventDefault })
  expect(document.activeElement).toBe(last)
})

it('leaves ordinary keys and buttons outside a tab list to their native behavior', () => {
  const button = document.createElement('button')
  document.body.append(button)
  const preventDefault = vi.fn()
  handlePaimindTabKey({ key: 'ArrowRight', currentTarget: button, preventDefault })
  handlePaimindTabKey({ key: 'Tab', currentTarget: button, preventDefault })
  expect(preventDefault).not.toHaveBeenCalled()
})
