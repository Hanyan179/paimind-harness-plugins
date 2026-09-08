import type { PaimindSettingsFieldSpec } from '@hansen/harness-compat/host'

export const BRANDING_NAMESPACE = 'hansen.branding'
export const MAX_LOGO_LENGTH = 350_000

export interface BrandingSettings {
  readonly brandName: string
  readonly logoUrl: string
  readonly darkLogoUrl: string
  readonly faviconUrl: string
  readonly welcomeZh: string
  readonly welcomeEn: string
}

export const DEFAULT_BRANDING: BrandingSettings = Object.freeze({
  brandName: 'Hansen', logoUrl: '', darkLogoUrl: '', faviconUrl: '',
  welcomeZh: '从一个想法开始', welcomeEn: 'Start with an idea',
})

export const BRANDING_FIELDS: Readonly<Record<keyof BrandingSettings, PaimindSettingsFieldSpec>> = Object.freeze(
  Object.fromEntries(Object.entries(DEFAULT_BRANDING).map(([field, value]) => [field, {
    kind: 'string', default: value,
    maxLength: field.endsWith('Url') ? MAX_LOGO_LENGTH : field === 'brandName' ? 80 : 160,
  }])) as Record<keyof BrandingSettings, PaimindSettingsFieldSpec>,
)

/** Allow persistent image sources only; never use HTML or executable URLs. */
export function isBrandImageUrl(value: string): boolean {
  if (value === '') return true
  if (value.length > MAX_LOGO_LENGTH || /[\s\u0000-\u001f\u007f\\]/u.test(value)) return false
  if (/^data:image\/(png|jpeg|webp|gif|x-icon|vnd\.microsoft\.icon);base64,[A-Za-z0-9+/]+={0,2}$/u.test(value)) return true
  if (value.startsWith('/') && !value.startsWith('//')) return true
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) && url.username === '' && url.password === ''
  } catch { return false }
}

export function decodeBrandingSettings(value: unknown): BrandingSettings | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const input = value as Record<string, unknown>
  const result = { ...DEFAULT_BRANDING }
  for (const field of Object.keys(result) as (keyof BrandingSettings)[]) {
    const raw = input[field]
    if (typeof raw !== 'string') continue
    const text = raw.trim()
    if (field.endsWith('Url')) result[field] = isBrandImageUrl(text) ? text : ''
    else if (!/[\u0000-\u001f\u007f]/u.test(text) && text.length <= (field === 'brandName' ? 80 : 160)) {
      result[field] = field === 'brandName' && text === '' ? DEFAULT_BRANDING.brandName : text
    }
  }
  return Object.freeze(result)
}

export function brandInitials(name: string): string {
  return Array.from(name.trim()).slice(0, 2).join('').toLocaleUpperCase() || 'H'
}

/** Text is XML-escaped before placing a user-provided name in an image. */
export function brandFallbackIcon(name: string): string {
  const initials = brandInitials(name).replace(/[&<>"']/gu, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character]!)
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#244b70"/><text x="32" y="42" text-anchor="middle" font-family="sans-serif" font-size="27" fill="white">${initials}</text></svg>`)}`
}
