import { registerPaimindHostSettings, type PaimindHostSettingsFacility } from '@hansen/harness-compat/host'
import { BRANDING_FIELDS, BRANDING_NAMESPACE, type BrandingSettings } from './settings.js'

/** Durable brand configuration; native Harness Settings owns persistence. */
export const name = 'paimind-branding'

export function apply(ctx: {
  inject(names: readonly string[], callback: (scope: { readonly settings: PaimindHostSettingsFacility }) => void): void
}): void {
  ctx.inject(['settings'], scope => {
    registerPaimindHostSettings<BrandingSettings>(scope.settings, BRANDING_NAMESPACE, BRANDING_FIELDS)
  })
}
