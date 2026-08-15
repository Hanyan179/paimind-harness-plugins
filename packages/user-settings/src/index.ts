import {
  PaimindHostRemoteService,
  describePaimindHostSettings,
  installPaimindHostSettings,
  markPaimindHostRemoteMethods,
  mutatePaimindHostSettings,
  type PaimindHostSettingsFacility,
  type PaimindHostSystemPrompt,
} from '@paimind/harness-compat/host'
import type { PaimindNotificationLevel } from '@paimind/contracts'
import {
  DEFAULT_PAIMIND_USER_PREFERENCES,
  PAIMIND_CITATION_POLICIES,
  PAIMIND_MOTION_POLICIES,
  PAIMIND_NOTIFICATION_POLICIES,
  PAIMIND_RESPONSE_LENGTHS,
  PAIMIND_RESPONSE_STRUCTURES,
  PAIMIND_RESPONSE_STYLES,
  PAIMIND_USER_SETTINGS_NAMESPACE,
  renderPaimindUserPreferencePrompt,
  decodePaimindUserPreferences,
  type PaimindUserSettingsMutationRequest,
  type PaimindUserSettingsView,
  type PaimindUserPreferences,
  type PaimindUserSettingsPolicy,
} from './preferences.js'

export * from './preferences.js'

export const name = 'paimind-user-settings'
export const inject = ['systemPrompt']

export interface PaimindUserSettingsHostContext {
  readonly systemPrompt: PaimindHostSystemPrompt
  get(name: 'settings'): PaimindHostSettingsFacility | undefined
  effect(install: () => void | (() => void | Promise<void>), label?: string): void
}

/** Live policy projection over the canonical Harness Settings document. */
export class PaimindUserSettingsService extends PaimindHostRemoteService implements PaimindUserSettingsPolicy {
  static inject = inject
  private source: () => Readonly<PaimindUserPreferences> = () => DEFAULT_PAIMIND_USER_PREFERENCES

  constructor(private readonly settingsCtx: PaimindUserSettingsHostContext) {
    super(settingsCtx, 'paimindUserSettings')
    markPaimindHostRemoteMethods(this, ['describe', 'mutate'])
    let removePrompt = (): void => {}
    const projectPrompt = (): void => {
      removePrompt()
      removePrompt = (): void => {}
      const text = renderPaimindUserPreferencePrompt(this.source())
      if (text !== '') removePrompt = settingsCtx.systemPrompt.section({
        name: 'paimind:user-preferences', order: 35, text,
      })
    }
    installPaimindHostSettings<PaimindUserPreferences>(settingsCtx, PAIMIND_USER_SETTINGS_NAMESPACE, {
      responseStyle: { kind: 'enum', values: [...PAIMIND_RESPONSE_STYLES], default: 'professional' },
      responseLength: { kind: 'enum', values: [...PAIMIND_RESPONSE_LENGTHS], default: 'balanced' },
      responseStructure: { kind: 'enum', values: [...PAIMIND_RESPONSE_STRUCTURES], default: 'automatic' },
      citations: { kind: 'enum', values: [...PAIMIND_CITATION_POLICIES], default: 'when-useful' },
      personalInstructions: { kind: 'string', default: '', maxLength: 3_000 },
      motion: { kind: 'enum', values: [...PAIMIND_MOTION_POLICIES], default: 'system' },
      notifications: { kind: 'enum', values: [...PAIMIND_NOTIFICATION_POLICIES], default: 'all' },
    }, { ...DEFAULT_PAIMIND_USER_PREFERENCES }, {
      setSource: current => { this.source = current },
      onChange: projectPrompt,
    })
    projectPrompt()
    settingsCtx.effect(() => () => { removePrompt() }, 'paimind-user-settings: prompt projection')
  }

  current(): Readonly<PaimindUserPreferences> {
    return this.source()
  }

  shouldPublishNotification(level: PaimindNotificationLevel): boolean {
    const policy = this.source().notifications
    if (policy === 'off') return false
    return policy === 'all' || level === 'warning' || level === 'error'
  }

  /** Narrow PAIMind-owned wire over the canonical Host settings namespace. */
  async describe(): Promise<Readonly<PaimindUserSettingsView>> {
    const settings = this.settingsCtx.get('settings')
    if (settings === undefined) return Object.freeze({ status: 'unavailable' })
    const descriptor = describePaimindHostSettings(settings, PAIMIND_USER_SETTINGS_NAMESPACE)
    if (descriptor === undefined) return Object.freeze({ status: 'unavailable' })
    const value = decodePaimindUserPreferences(descriptor.value)
    if (value === undefined) throw new Error('PAIMind user settings resolved an invalid section')
    return Object.freeze({
      status: 'ready', value, revision: descriptor.revision, writable: descriptor.writable,
    })
  }

  /** Write one validated field with the native namespace revision as CAS fence. */
  async mutate(request: PaimindUserSettingsMutationRequest): Promise<Readonly<PaimindUserSettingsView>> {
    const settings = this.settingsCtx.get('settings')
    if (settings === undefined) return Object.freeze({ status: 'unavailable' })
    await mutatePaimindHostSettings(
      settings,
      PAIMIND_USER_SETTINGS_NAMESPACE,
      request.field,
      request.value,
      request.expectedRevision,
    )
    return await this.describe()
  }
}

/** Explicit Cordis entry: registration is an install action, not a class-export convention. */
export function apply(ctx: PaimindUserSettingsHostContext): void {
  new PaimindUserSettingsService(ctx)
}
