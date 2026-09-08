import {
  PaimindHostRemoteService,
  describePaimindHostSettings,
  describePaimindHostSettingsUserLayer,
  installPaimindHostSettings,
  markPaimindHostRemoteMethods,
  mutatePaimindHostSettings,
  mutatePaimindHostSettingsOperations,
  type PaimindHostSettingsFacility,
  type PaimindHostSettingsMutationOperation,
  type PaimindHostSystemPrompt,
} from '@hansen/harness-compat/host'
import {
  DEFAULT_PAIMIND_PERSONALIZATION,
  PAIMIND_PERSONALITIES,
  PAIMIND_USER_SETTINGS_NAMESPACE,
  decodePaimindPersonalization,
  renderPaimindPersonalizationContext,
  type PaimindPersonalization,
  type PaimindPersonalizationMutationRequest,
  type PaimindPersonalizationView,
} from './preferences.js'

export * from './preferences.js'

export const name = 'paimind-user-settings'
export const inject = ['systemPrompt']

export interface PaimindUserSettingsHostContext {
  readonly systemPrompt: PaimindHostSystemPrompt
  get(name: 'settings'): PaimindHostSettingsFacility | undefined
  effect(install: () => void | (() => void | Promise<void>), label?: string): void
}

const LEGACY_FIELDS = [
  'responseStyle', 'responseLength', 'responseStructure', 'citations',
  'personalInstructions', 'motion', 'notifications',
] as const

function legacyMigrationOperations(user: unknown): readonly PaimindHostSettingsMutationOperation[] {
  if (typeof user !== 'object' || user === null || Array.isArray(user)) return []
  const source = user as Record<string, unknown>
  const operations: PaimindHostSettingsMutationOperation[] = []
  if (!Object.hasOwn(source, 'personality') && typeof source.responseStyle === 'string') {
    const personality = source.responseStyle === 'friendly' ? 'friendly' : 'pragmatic'
    operations.push({ op: 'set', path: ['personality'], value: personality })
  }
  if (!Object.hasOwn(source, 'customInstructions')
    && typeof source.personalInstructions === 'string'
    && source.personalInstructions.trim() !== '') {
    operations.push({ op: 'set', path: ['customInstructions'], value: source.personalInstructions })
  }
  for (const field of LEGACY_FIELDS) {
    if (Object.hasOwn(source, field)) operations.push({ op: 'unset', path: [field] })
  }
  return operations
}

/** Convert the retired broad-preference fields once without losing useful user-authored text. */
export async function migrateLegacyPaimindPersonalization(settings: PaimindHostSettingsFacility): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const descriptor = describePaimindHostSettingsUserLayer(settings, PAIMIND_USER_SETTINGS_NAMESPACE)
    if (descriptor === undefined) return
    const operations = legacyMigrationOperations(descriptor.user)
    if (operations.length === 0) return
    try {
      await mutatePaimindHostSettingsOperations(
        settings, PAIMIND_USER_SETTINGS_NAMESPACE, operations, descriptor.revision,
      )
      return
    } catch (error) {
      if (attempt === 1) throw error
    }
  }
}

/** Live Personalization projection over the canonical Harness Settings document. */
export class PaimindUserSettingsService extends PaimindHostRemoteService {
  static inject = inject
  private source: () => Readonly<PaimindPersonalization> = () => DEFAULT_PAIMIND_PERSONALIZATION

  constructor(private readonly settingsCtx: PaimindUserSettingsHostContext) {
    super(settingsCtx, 'paimindUserSettings')
    markPaimindHostRemoteMethods(this, ['describe', 'mutate'])
    let removeContext = (): void => {}
    const projectContext = (): void => {
      removeContext()
      removeContext = (): void => {}
      const text = renderPaimindPersonalizationContext(this.source())
      if (text !== '') removeContext = settingsCtx.systemPrompt.context({
        name: 'paimind:personalization', order: 40, text,
      })
    }
    installPaimindHostSettings<PaimindPersonalization>(settingsCtx, PAIMIND_USER_SETTINGS_NAMESPACE, {
      enabled: { kind: 'boolean', default: true },
      personality: { kind: 'enum', values: [...PAIMIND_PERSONALITIES], default: 'none' },
      aboutMe: { kind: 'string', default: '', maxLength: 2_000 },
      customInstructions: { kind: 'string', default: '', maxLength: 3_000 },
    }, { ...DEFAULT_PAIMIND_PERSONALIZATION }, {
      setSource: current => { this.source = current },
      onChange: projectContext,
    })
    projectContext()
    settingsCtx.effect(() => {
      let active = true
      const settings = settingsCtx.get('settings')
      if (settings !== undefined) {
        void migrateLegacyPaimindPersonalization(settings).catch(error => {
          if (active) console.warn('[paimind-user-settings] legacy preference migration failed', error)
        })
      }
      return () => { active = false }
    }, 'paimind-user-settings: legacy preference migration')
    settingsCtx.effect(() => () => { removeContext() }, 'paimind-user-settings: personalization context projection')
  }

  /** Narrow PAIMind-owned wire over the canonical Host settings namespace. */
  async describe(): Promise<Readonly<PaimindPersonalizationView>> {
    const settings = this.settingsCtx.get('settings')
    if (settings === undefined) return Object.freeze({ status: 'unavailable' })
    await migrateLegacyPaimindPersonalization(settings)
    const descriptor = describePaimindHostSettings(settings, PAIMIND_USER_SETTINGS_NAMESPACE)
    if (descriptor === undefined) return Object.freeze({ status: 'unavailable' })
    const value = decodePaimindPersonalization(descriptor.value)
    if (value === undefined) throw new Error('PAIMind personalization resolved an invalid section')
    return Object.freeze({
      status: 'ready', value, revision: descriptor.revision, writable: descriptor.writable,
    })
  }

  /** Write one validated field with the native namespace revision as CAS fence. */
  async mutate(request: PaimindPersonalizationMutationRequest): Promise<Readonly<PaimindPersonalizationView>> {
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
