import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { PAIMIND_UI_FOUNDATION_CSS } from '../src/index.js'

describe('PAIMind UI foundation', () => {
  it('keeps all shared tokens and primitives scoped to an explicit PAIMind surface', () => {
    expect(PAIMIND_UI_FOUNDATION_CSS).toContain(':where([data-paimind-ui-scope])')
    expect(PAIMIND_UI_FOUNDATION_CSS).toContain('--paimind-ui-accent')
    expect(PAIMIND_UI_FOUNDATION_CSS).toContain(':focus-visible')
    expect(PAIMIND_UI_FOUNDATION_CSS).not.toMatch(/(^|\n)\s*(html|body|:root)\s*\{/)
  })

  it('installs as valid style text without mutating elements outside the scope', () => {
    const dom = new JSDOM('<!doctype html><button id="outside">Outside</button><section data-paimind-ui-scope><button id="inside" data-paimind-ui-button>Inside</button></section>')
    const style = dom.window.document.createElement('style')
    style.textContent = PAIMIND_UI_FOUNDATION_CSS
    dom.window.document.head.append(style)
    expect(dom.window.document.styleSheets).toHaveLength(1)
    expect(dom.window.document.querySelector('#outside')?.hasAttribute('data-paimind-ui-button')).toBe(false)
    expect(dom.window.document.querySelector('#inside')?.closest('[data-paimind-ui-scope]')).not.toBeNull()
  })
})
