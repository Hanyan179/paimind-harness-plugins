import {
  installPaimindConversationTitleAutomation,
  registerPaimindHostSettings,
  type PaimindConversationTitleAutomationContext,
  type PaimindHostSettingsFacility,
} from '@paimind/harness-compat/host'
import {
  buildPaimindConversationTitlePrompt,
  decodePaimindConversationTitleModelRoute,
  DEFAULT_PAIMIND_CONVERSATION_TITLE_SETTINGS,
  finalizePaimindConversationTitle,
  PAIMIND_CONVERSATION_TITLE_FIELDS,
  PAIMIND_CONVERSATION_TITLE_NAMESPACE,
  temporaryPaimindConversationTitle,
  type PaimindConversationTitleSettings,
} from './settings.js'

export const name = 'paimind-conversation-title'
export const inject = ['settings', 'sessionTitle', 'llm']

interface ConversationTitleContext extends PaimindConversationTitleAutomationContext {
  readonly settings: PaimindHostSettingsFacility
  effect(install: () => () => void, label?: string): void
}

/** Register settings and the non-blocking title lifecycle over native Harness services. */
export function apply(ctx: ConversationTitleContext): void {
  const settings = registerPaimindHostSettings<PaimindConversationTitleSettings>(
    ctx.settings,
    PAIMIND_CONVERSATION_TITLE_NAMESPACE,
    PAIMIND_CONVERSATION_TITLE_FIELDS,
    { base: DEFAULT_PAIMIND_CONVERSATION_TITLE_SETTINGS, applies: 'live' },
  )
  ctx.effect(() => installPaimindConversationTitleAutomation(ctx, {
    providerId: name,
    enabled: () => settings.get().enabled,
    route: () => decodePaimindConversationTitleModelRoute(settings.get().modelRoute),
    temporaryTitle: temporaryPaimindConversationTitle,
    prompt: buildPaimindConversationTitlePrompt,
    finalizeTitle: finalizePaimindConversationTitle,
    maxOutputTokens: 64,
    timeoutMs: 15_000,
  }), 'paimind-conversation-title: native Session lifecycle')
}

export {
  buildPaimindConversationTitlePrompt,
  decodePaimindConversationTitleModelRoute,
  decodePaimindConversationTitleSettings,
  DEFAULT_PAIMIND_CONVERSATION_TITLE_SETTINGS,
  encodePaimindConversationTitleModelRoute,
  finalizePaimindConversationTitle,
  PAIMIND_CONVERSATION_TITLE_MAX_CHARACTERS,
  PAIMIND_CONVERSATION_TITLE_NAMESPACE,
  PAIMIND_CONVERSATION_TITLE_PROMPT_MAX_BYTES,
  PAIMIND_CONVERSATION_TITLE_PROMPT_PREFIX,
  temporaryPaimindConversationTitle,
  type PaimindConversationTitleModelRoute,
  type PaimindConversationTitleSettings,
} from './settings.js'
