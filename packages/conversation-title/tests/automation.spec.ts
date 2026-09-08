import { describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import {
  installPaimindConversationTitleAutomation,
  type PaimindConversationTitleAutomationContext,
  type PaimindConversationTitleSession,
  type PaimindConversationTitleSessionEvent,
  type PaimindConversationTitleSnapshot,
} from '@hansen/harness-compat/host'
import {
  buildPaimindConversationTitlePrompt,
  finalizePaimindConversationTitle,
  temporaryPaimindConversationTitle,
} from '../src/settings.js'

type EventListener = (session: PaimindConversationTitleSession, event: PaimindConversationTitleSessionEvent) => void
type DisposeListener = (session: PaimindConversationTitleSession) => void

function textChunks(text: string): AsyncIterable<unknown> {
  return (async function* () {
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })()
}

function bench(
  generate: (prompt: string) => AsyncIterable<unknown> = prompt => textChunks(prompt.includes('设计') ? '设计模型服务' : 'Name conversation'),
  nativeFallback = false,
) {
  let snapshot: PaimindConversationTitleSnapshot | undefined
  let seq = 10
  const eventListeners = new Set<EventListener>()
  const disposeListeners = new Set<DisposeListener>()
  const requests: string[] = []
  const session: PaimindConversationTitleSession = {
    id: 'session-1',
    append(_type, data) {
      seq += 1
      snapshot = { title: data.title, eventSeq: seq, source: { kind: data.source.kind } }
    },
  }
  const ctx: PaimindConversationTitleAutomationContext = {
    sessionTitle: { get: () => snapshot },
    llm: {
      stream(options) {
        const prompt = options.messages[0]?.content.find(block => block.type === 'text')
        const text = prompt?.type === 'text' ? prompt.text : ''
        requests.push(text)
        return generate(text)
      },
    },
    logger: { warn: vi.fn() },
    on(event: 'session/event' | 'session/disposed', listener: EventListener | DisposeListener) {
      if (event === 'session/event') eventListeners.add(listener as EventListener)
      else disposeListeners.add(listener as DisposeListener)
      return () => {
        if (event === 'session/event') eventListeners.delete(listener as EventListener)
        else disposeListeners.delete(listener as DisposeListener)
      }
    },
  } as PaimindConversationTitleAutomationContext
  const dispose = installPaimindConversationTitleAutomation(ctx, {
    providerId: 'paimind-conversation-title', enabled: () => true,
    route: () => ({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }),
    temporaryTitle: temporaryPaimindConversationTitle,
    prompt: buildPaimindConversationTitlePrompt,
    finalizeTitle: finalizePaimindConversationTitle,
    maxOutputTokens: 64, timeoutMs: 1_000,
  })
  const emit = (event: PaimindConversationTitleSessionEvent): void => {
    if (nativeFallback && event.type === 'user/message') {
      seq += 1
      snapshot = { title: '原生临时标题', eventSeq: seq, source: { kind: 'fallback' } }
    }
    for (const listener of [...eventListeners]) listener(session, event)
  }
  return {
    ctx, session, requests, emit, dispose,
    snapshot: () => snapshot,
    rename(title: string) { seq += 1; snapshot = { title, eventSeq: seq, source: { kind: 'user' } } },
  }
}

function userMessage(seq: number, text: string): PaimindConversationTitleSessionEvent {
  return { type: 'user/message', seq, data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } }
}

describe('conversation title automation', () => {
  it('uses the native Harness title-provider lifecycle when register is available', async () => {
    let provider: {
      generate(request: {
        session: PaimindConversationTitleSession
        messages: readonly { seq: number; text: string }[]
        route?: { provider: string; model: string }
        signal: AbortSignal
      }): Promise<{ title: string; messageSeqs: readonly number[]; model?: { provider: string; model: string } }>
    } | undefined
    const session: PaimindConversationTitleSession = { id: 'native-title-session', append: vi.fn() }
    const ctx = {
      sessionTitle: {
        get: () => undefined,
        register(value: typeof provider) { provider = value; return () => {} },
      },
      llm: { stream: () => textChunks('创建交期风险助手') },
      logger: { warn: vi.fn() },
      on: vi.fn(),
    } as unknown as PaimindConversationTitleAutomationContext
    const dispose = installPaimindConversationTitleAutomation(ctx, {
      providerId: 'paimind-conversation-title', enabled: () => true,
      route: () => undefined,
      temporaryTitle: temporaryPaimindConversationTitle,
      prompt: buildPaimindConversationTitlePrompt,
      finalizeTitle: finalizePaimindConversationTitle,
      maxOutputTokens: 64, timeoutMs: 1_000,
    })
    const result = await provider?.generate({
      session, messages: [{ seq: 7, text: '创建一个帮我检查交期风险的智能体' }],
      route: { provider: 'deepseek-official', model: 'deepseek-v4-flash' }, signal: new AbortController().signal,
    })
    expect(result).toEqual({
      title: '创建交期风险助手', messageSeqs: [7], model: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    })
    await dispose()
  })

  it('shows a temporary title in the same event turn and replaces it in the background', async () => {
    const b = bench()
    b.emit(userMessage(1, '设计   模型服务设置页面'))
    await Promise.resolve()
    expect(b.snapshot()?.title).toBe('设计 模型服务设置页面')
    await waitFor(() => { expect(b.snapshot()?.title).toBe('设计模型服务') })
    expect(b.requests).toHaveLength(1)
    expect(b.requests[0]).toContain('User prompt: 设计   模型服务设置页面')
    b.dispose()
  })

  it('replaces the native same-event fallback before starting the formal title call', async () => {
    const b = bench(undefined, true)
    b.emit(userMessage(1, '设计   模型服务设置页面'))
    await Promise.resolve()
    expect(b.snapshot()?.title).toBe('设计 模型服务设置页面')
    await waitFor(() => { expect(b.snapshot()?.title).toBe('设计模型服务') })
    expect(b.requests).toHaveLength(1)
    b.dispose()
  })

  it('does not overwrite a manual title with a late model result', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>(resolve => { release = resolve })
    const b = bench(() => (async function* () {
      await gate
      yield { type: 'text-delta', index: 0, text: '迟到标题' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })())
    b.emit(userMessage(1, '开始一个很长的任务'))
    await Promise.resolve()
    b.rename('用户标题')
    release?.()
    await waitFor(() => { expect(b.requests).toHaveLength(1) })
    await Promise.resolve()
    expect(b.snapshot()?.title).toBe('用户标题')
    b.dispose()
  })

  it('keeps the temporary title after failure and never retries on later messages', async () => {
    const b = bench(() => (async function* () { throw new Error('provider unavailable') })())
    b.emit(userMessage(200, '迁移后的旧对话继续工作'))
    await waitFor(() => { expect(b.requests).toHaveLength(1) })
    expect(b.snapshot()?.title).toBe('迁移后的旧对话继续工作')
    b.emit(userMessage(201, '第二条消息'))
    await Promise.resolve()
    expect(b.requests).toHaveLength(1)
    expect(b.snapshot()?.title).toBe('迁移后的旧对话继续工作')
    b.dispose()
  })
})
