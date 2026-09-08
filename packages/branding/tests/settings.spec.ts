import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.js'
import { brandFallbackIcon, decodeBrandingSettings, DEFAULT_BRANDING, isBrandImageUrl } from '../src/settings.js'

describe('Brand identity settings', () => {
  it('registers one native namespace with durable defaults', () => {
    const register = vi.fn(() => ({ get: () => DEFAULT_BRANDING }))
    apply({ inject: (_names, callback) => callback({ settings: { register } as never, on: vi.fn() }) })
    expect(register).toHaveBeenCalledOnce()
    expect(String(register.mock.calls[0]![0])).toBe('hansen-branding')
  })
  it('uses neutral defaults and safely normalizes malformed persisted fields', () => {
    expect(decodeBrandingSettings({})).toEqual(DEFAULT_BRANDING)
    expect(decodeBrandingSettings(null)).toBeUndefined()
    expect(decodeBrandingSettings({ brandName: '  ', logoUrl: 'javascript:alert(1)', welcomeZh: '', welcomeEn: 'x'.repeat(161) }))
      .toEqual({ ...DEFAULT_BRANDING, welcomeZh: '' })
  })
  it('rejects ephemeral, executable and credential-bearing image addresses', () => {
    for (const source of ['javascript:alert(1)', 'blob:https://example.com/1', 'file:///tmp/image', '//example.com/logo', 'https://user:password@example.com/logo', 'data:text/html;base64,PHNjcmlwdD4=', '/\\evil.com/x']) expect(isBrandImageUrl(source)).toBe(false)
    for (const source of ['', '/assets/logo.svg', 'https://example.com/logo.svg', 'data:image/png;base64,iVBORw==']) expect(isBrandImageUrl(source)).toBe(true)
    expect(decodeURIComponent(brandFallbackIcon('<&'))).toContain('&lt;&amp;')
  })
})
