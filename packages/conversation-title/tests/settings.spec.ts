import { describe, expect, it } from 'vitest'
import {
  buildPaimindConversationTitlePrompt,
  decodePaimindConversationTitleModelRoute,
  encodePaimindConversationTitleModelRoute,
  finalizePaimindConversationTitle,
  PAIMIND_CONVERSATION_TITLE_PROMPT_MAX_BYTES,
  PAIMIND_CONVERSATION_TITLE_PROMPT_PREFIX,
  temporaryPaimindConversationTitle,
} from '../src/settings.js'

describe('conversation title policy', () => {
  it('creates the immediate title from thirty-six complete normalized characters', () => {
    expect(temporaryPaimindConversationTitle('  设计   新的\n模型服务设置页面  ')).toBe('设计 新的 模型服务设置页面')
    expect(temporaryPaimindConversationTitle('😀'.repeat(40))).toBe('😀'.repeat(36))
  })

  it('keeps the exact fixed prompt and truncates only user text within 960 UTF-8 bytes', () => {
    const prompt = buildPaimindConversationTitlePrompt('需求😀'.repeat(500))
    expect(prompt.startsWith(PAIMIND_CONVERSATION_TITLE_PROMPT_PREFIX)).toBe(true)
    expect(Buffer.byteLength(prompt, 'utf8')).toBeLessThanOrEqual(PAIMIND_CONVERSATION_TITLE_PROMPT_MAX_BYTES)
    expect(prompt.endsWith('\ufffd')).toBe(false)
  })

  it('normalizes a generated title and preserves model routes atomically', () => {
    expect(finalizePaimindConversationTitle('“设计模型服务页面。”\n')).toBe('设计模型服务页面')
    const encoded = encodePaimindConversationTitleModelRoute({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
    expect(decodePaimindConversationTitleModelRoute(encoded)).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
    expect(decodePaimindConversationTitleModelRoute('{broken')).toBeUndefined()
  })
})
