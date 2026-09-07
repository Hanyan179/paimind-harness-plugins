import { afterEach, expect, it } from 'vitest'
import { markHarnessClientStyle } from '../src/index.js'

afterEach(() => { document.head.querySelectorAll('style[data-style-ownership-test]').forEach(style => style.remove()) })

it('keeps late-created styles out of another module materialization and cleanup', () => {
  const own = document.createElement('style')
  const other = document.createElement('style')
  own.dataset.styleOwnershipTest = ''
  other.dataset.styleOwnershipTest = ''
  markHarnessClientStyle(own, '@paimind/visual-experience')
  document.head.append(own, other)
  // Native RC client-modules claims untagged styles for the materializing module.
  for (const style of document.head.querySelectorAll('style[data-style-ownership-test]:not([data-plugin])')) {
    style.setAttribute('data-plugin', '@paimind/other')
  }
  for (const style of document.head.querySelectorAll('style[data-plugin="@paimind/other"]')) style.remove()
  expect(own.isConnected).toBe(true)
  expect(own).toHaveAttribute('data-plugin', '@paimind/visual-experience')
  expect(other.isConnected).toBe(false)
  own.remove()
  expect(document.head.querySelectorAll('style[data-style-ownership-test]')).toHaveLength(0)
})
