// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { createBrandingBootInjection } from '../src/index.js'
afterEach(() => { window.dispatchEvent(new Event('pagehide')); document.body.innerHTML = '' })
it('sets saved tab identity before any client plugin and safely encodes user text', () => {
  document.head.innerHTML = '<title>DeepSeek Harness</title><link rel="icon" type="image/svg+xml" href="/old.svg">'
  const name = 'My </script> Brand'
  const injection = createBrandingBootInjection({ brandName: name, faviconUrl: '/custom.png' })
  expect(injection.text).not.toContain('</script>')
  new Function(injection.text)()
  expect(document.title).toBe(name)
  expect(document.querySelector('link[rel="icon"]')?.getAttribute('href')).toBe('/custom.png')
  expect(document.querySelector('link[rel="icon"]')).not.toHaveAttribute('type')
})
it('uses the current main logo when the optional favicon is empty', () => {
  new Function(createBrandingBootInjection({ brandName: 'New brand', logoUrl: '/logo.png' }).text)()
  expect(document.title).toBe('New brand')
  expect(document.querySelector('link[rel="icon"]')?.getAttribute('href')).toBe('/logo.png')
})
it('brands a late boot page without hiding plugin failure details', async () => {
  new Function(createBrandingBootInjection({ brandName: 'North', browserTitle: 'North Workspace', logoUrl: '/north.png' }).text)()
  document.body.innerHTML = '<div data-dsh-boot><div><div>HARNESS</div><div data-dsh-boot-spinner></div><div>Failed to load plugins</div><pre>invalid manifest</pre></div></div>'
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(document.querySelector('[data-hansen-boot-brand]')).toHaveTextContent('North')
  expect(document.querySelector('[data-hansen-boot-brand] img')).toHaveAttribute('src', '/north.png')
  expect(document.body).toHaveTextContent('invalid manifest')
  expect(document.title).toBe('North Workspace')
  document.body.innerHTML = ''
  window.dispatchEvent(new Event('pagehide'))
})
