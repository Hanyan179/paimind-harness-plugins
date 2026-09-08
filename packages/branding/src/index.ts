import { createHarnessBootBrandScript, registerPaimindHostSettings, type PaimindHostSettingsFacility } from '@hansen/harness-compat/host'
import { BRANDING_FIELDS, BRANDING_NAMESPACE, DEFAULT_BRANDING, brandFallbackIcon, decodeBrandingSettings, type BrandingSettings } from './settings.js'

export const name = 'paimind-branding'

/** Render the saved identity before client plugins start, without a browser cache. */
export function createBrandingBootInjection(value: unknown) {
  const decoded = decodeBrandingSettings(value) ?? DEFAULT_BRANDING
  const brand = { ...decoded, brandName: decoded.brandName || DEFAULT_BRANDING.brandName }
  const identity = JSON.stringify({ name: brand.browserTitle || brand.brandName, icon: brand.faviconUrl || brand.logoUrl || brandFallbackIcon(brand.brandName) }).replace(/</gu, '\\u003c')
  return { kind: 'script' as const, placement: 'head' as const, text: `(() => {
    const brand = ${identity};
    const apply = () => {
      document.title = brand.name;
      let icons = [...document.head.querySelectorAll('link[rel~="icon"]')];
      if (!icons.length) { const icon = document.createElement('link'); icon.rel = 'icon'; document.head.append(icon); icons = [icon]; }
      for (const icon of icons) { icon.removeAttribute('type'); icon.href = brand.icon; }
    };
    apply();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once: true });
  })();${createHarnessBootBrandScript({ name: brand.brandName, logo: brand.logoUrl, darkLogo: brand.darkLogoUrl })}` }
}

/** Native Settings remains the only persisted brand source. */
export function apply(ctx: {
  inject(names: readonly string[], callback: (scope: {
    readonly settings: PaimindHostSettingsFacility
    on(name: 'webserver/index-inject', callback: (table: ReturnType<typeof createBrandingBootInjection>[]) => void): unknown
  }) => void): void
}): void {
  ctx.inject(['settings'], scope => {
    const settings = registerPaimindHostSettings<BrandingSettings>(scope.settings, BRANDING_NAMESPACE, BRANDING_FIELDS)
    scope.on('webserver/index-inject', table => { table.push(createBrandingBootInjection(settings.get())) })
  })
}
