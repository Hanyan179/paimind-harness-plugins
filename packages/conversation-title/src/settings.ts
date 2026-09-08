import type { PaimindSettingsFieldSpec } from '@hansen/harness-compat/host'

export const PAIMIND_CONVERSATION_TITLE_NAMESPACE = 'paimind.conversation-title'
export const PAIMIND_CONVERSATION_TITLE_PROMPT_MAX_BYTES = 960
export const PAIMIND_CONVERSATION_TITLE_MAX_CHARACTERS = 36

export const PAIMIND_CONVERSATION_TITLE_PROMPT_PREFIX = [
  'Generate a concise, single-line task title of at most 36 characters and under five words where possible. Start with an imperative verb. Capitalize only the first word unless the user\'s language, proper nouns, acronyms, or code terms require otherwise. Preserve ticket references exactly. Write in the user\'s language. Do not use quotes, markdown, or trailing punctuation. Do not answer the request.',
  '',
  'User prompt: ',
].join('\n')

export interface PaimindConversationTitleSettings {
  readonly enabled: boolean
  /** Empty follows the triggering conversation route; otherwise stores a JSON [provider, model] pair. */
  readonly modelRoute: string
}

export const DEFAULT_PAIMIND_CONVERSATION_TITLE_SETTINGS: Readonly<PaimindConversationTitleSettings> = Object.freeze({
  enabled: true,
  modelRoute: '',
})

export const PAIMIND_CONVERSATION_TITLE_FIELDS: Readonly<Record<keyof PaimindConversationTitleSettings, PaimindSettingsFieldSpec>> = Object.freeze({
  enabled: { kind: 'boolean', default: true, description: 'Generate a concise title after the first eligible user message.' },
  modelRoute: { kind: 'string', default: '', maxLength: 512, description: 'Optional JSON provider/model route for title generation.' },
})

export interface PaimindConversationTitleModelRoute {
  readonly provider: string
  readonly model: string
}

export function encodePaimindConversationTitleModelRoute(route: PaimindConversationTitleModelRoute | undefined): string {
  return route === undefined ? '' : JSON.stringify([route.provider, route.model])
}

export function decodePaimindConversationTitleModelRoute(value: string): PaimindConversationTitleModelRoute | undefined {
  if (value === '') return undefined
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed) || parsed.length !== 2) return undefined
    const [provider, model] = parsed
    if (typeof provider !== 'string' || provider.length === 0 || typeof model !== 'string' || model.length === 0) return undefined
    return Object.freeze({ provider, model })
  } catch {
    return undefined
  }
}

export function decodePaimindConversationTitleSettings(value: unknown): PaimindConversationTitleSettings | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const candidate = value as Record<string, unknown>
  if (typeof candidate.enabled !== 'boolean' || typeof candidate.modelRoute !== 'string') return undefined
  return Object.freeze({ enabled: candidate.enabled, modelRoute: candidate.modelRoute })
}

function utf8Prefix(input: string, maxBytes: number): string {
  let used = 0
  let output = ''
  for (const character of input) {
    const bytes = Buffer.byteLength(character, 'utf8')
    if (used + bytes > maxBytes) break
    output += character
    used += bytes
  }
  return output
}

function cleanOneLine(input: string): string {
  return input
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

function graphemePrefix(input: string, maxCharacters: number): string {
  const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(input)
  let output = ''
  let count = 0
  for (const segment of segments) {
    if (count >= maxCharacters) break
    output += segment.segment
    count += 1
  }
  return output
}

export function temporaryPaimindConversationTitle(message: string): string {
  return graphemePrefix(cleanOneLine(message), PAIMIND_CONVERSATION_TITLE_MAX_CHARACTERS).trimEnd()
}

export function buildPaimindConversationTitlePrompt(message: string): string {
  const prefixBytes = Buffer.byteLength(PAIMIND_CONVERSATION_TITLE_PROMPT_PREFIX, 'utf8')
  if (prefixBytes >= PAIMIND_CONVERSATION_TITLE_PROMPT_MAX_BYTES) {
    throw new Error('conversation-title prompt prefix exceeds its byte budget')
  }
  const user = utf8Prefix(message, PAIMIND_CONVERSATION_TITLE_PROMPT_MAX_BYTES - prefixBytes)
  return `${PAIMIND_CONVERSATION_TITLE_PROMPT_PREFIX}${user}`
}

export function finalizePaimindConversationTitle(output: string): string | undefined {
  let title = cleanOneLine(output)
  const wrappers: readonly [string, string][] = [['"', '"'], ["'", "'"], ['“', '”'], ['‘', '’'], ['`', '`']]
  for (const [start, end] of wrappers) {
    if (title.startsWith(start) && title.endsWith(end) && title.length > start.length + end.length) {
      title = title.slice(start.length, -end.length).trim()
      break
    }
  }
  title = title.replace(/[。！？.!?;；:：]+$/u, '').trimEnd()
  title = graphemePrefix(title, PAIMIND_CONVERSATION_TITLE_MAX_CHARACTERS).trimEnd()
  return title === '' ? undefined : title
}
