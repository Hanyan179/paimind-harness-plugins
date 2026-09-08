// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { createBrandingBootInjection } from '../src/index.js'
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
