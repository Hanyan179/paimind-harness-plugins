import {
  registerPaimindHostSettings,
  type PaimindHostSettingsFacility,
} from '@paimind/harness-compat/host'
import {
  PAIMIND_VISUAL_EXPERIENCE_FIELDS,
  PAIMIND_VISUAL_EXPERIENCE_NAMESPACE,
  type PaimindVisualExperienceSettings,
} from './settings.js'

export const name = 'paimind-visual-experience'

/** Register the durable native Settings namespace; the client owns presentation. */
export function apply(ctx: {
  inject(names: readonly string[], callback: (scope: { readonly settings: PaimindHostSettingsFacility }) => void): void
}): void {
  ctx.inject(['settings'], scope => {
    registerPaimindHostSettings<PaimindVisualExperienceSettings>(
      scope.settings,
      PAIMIND_VISUAL_EXPERIENCE_NAMESPACE,
      PAIMIND_VISUAL_EXPERIENCE_FIELDS,
    )
  })
}

export {
  DEFAULT_PAIMIND_EXPERIENCE_MODE,
  PAIMIND_EXPERIENCE_MODES,
  PAIMIND_VISUAL_EXPERIENCE_NAMESPACE,
  type PaimindExperienceMode,
  type PaimindVisualExperienceSettings,
} from './settings.js'
