import { registerPaimindHostSettings, registerPaimindHostLiteralPrompt,
  type PaimindHostSettingsFacility, type PaimindHostSystemPrompt } from '@paimind/harness-compat/host'

/** Enterprise UI is a native Harness client contribution, not a second shell. */
export const name = 'paimind-enterprise-admin'
export const inject = ['settings', 'systemPrompt']

interface EnterpriseInstructionSettings { enabled: boolean; instructions: string }
interface EnterpriseInstructionContext {
  readonly settings: PaimindHostSettingsFacility
  readonly systemPrompt: PaimindHostSystemPrompt
  effect(install: () => () => void, label?: string): void
}

/** Identity and authorization are owned by the authenticated gateway. This
 * plugin exposes no host RPC that can bypass that server-side boundary.
 * Settings persistence and prompt assembly stay native and cell-local. The
 * enterprise namespace adds instructions only: it does not replace persona,
 * tools, safety guards, Agent profiles or personal collaboration defaults. */
export function apply(ctx: EnterpriseInstructionContext): void {
  const settings = registerPaimindHostSettings<EnterpriseInstructionSettings>(ctx.settings,
    'paimind-enterprise-instructions', {
      enabled: { kind: 'boolean', default: true },
      instructions: { kind: 'string', default: '', maxLength: 8_000 },
    }, { applies: 'live' })
  ctx.effect(() => registerPaimindHostLiteralPrompt(ctx.systemPrompt, {
    name: 'paimind:enterprise-instructions', order: 20, variable: 'paimind_enterprise_instructions',
    // Read the original owner's current snapshot at each native assembly. No
    // second cache, watcher lag, timer or per-Agent copied prompt is needed.
    text: () => { const value = settings.get(); return value.enabled ? value.instructions : '' },
  }), 'paimind-enterprise-admin: native per-cell instructions')
}
