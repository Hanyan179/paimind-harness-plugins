import { useEffect, useState } from 'react'
import type { HarnessSessionHistoryApi, HarnessSessionHistoryEvent } from '@hansen/harness-compat'
import { assistantTextFromHistoryEvent, turnEndFailure, turnEndReason } from './authoring-session.js'

type HistoryPage = Awaited<ReturnType<HarnessSessionHistoryApi['history']>>['result']
export interface TestHistoryReader {
  readTestHistory(agentId: string, sessionId: string, beforeSeq?: number, signal?: AbortSignal): Promise<HistoryPage>
}

function visibleText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content.flatMap(block => {
    if (typeof block !== 'object' || block === null) return []
    if (block.type === 'text' && typeof block.text === 'string') return [block.text]
    if (block.type === 'tool-result') return [visibleText(block.content)]
    return []
  }).filter(Boolean).join('\n')
}

function message(event: HarnessSessionHistoryEvent): { role: 'user' | 'assistant' | 'tool' | 'error'; text: string } | null {
  const data = event.data as { source?: { kind?: string }; content?: unknown; message?: { content?: unknown }; error?: { message?: unknown }; name?: string } | undefined
  // Native context injections also use user/message. Only actual user input
  // belongs in the transcript; source metadata, never text matching, decides.
  if (event.type === 'user/message' && data?.source?.kind === 'user') return { role: 'user', text: visibleText(data.content) }
  if (event.type === 'assistant/message') return { role: 'assistant', text: assistantTextFromHistoryEvent(event) }
  if (event.type === 'tool/call') return { role: 'tool', text: data?.name ?? '' }
  if (event.type === 'tool/result') return { role: 'tool', text: visibleText(data?.message?.content) }
  if (event.type === 'agent/error' && typeof data?.error?.message === 'string') return { role: 'error', text: data.error.message }
  if (event.type === 'turn/end' && turnEndReason(event) === 'error') return { role: 'error', text: turnEndFailure(event) }
  return null
}

/** Read-only, paginated projection of the native transcript, including archived Sessions. */
export function TestSessionHistory(props: {
  runtime: TestHistoryReader
  agentId: string
  sessionId: string
  title: string
  zh: boolean
  close(): void
}): React.JSX.Element {
  const [events, setEvents] = useState<readonly HarnessSessionHistoryEvent[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [beforeSeq, setBeforeSeq] = useState<number | undefined>()
  const [request, setRequest] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    void props.runtime.readTestHistory(props.agentId, props.sessionId, beforeSeq, controller.signal).then(result => {
      if (controller.signal.aborted) return
      if (!result.ok) throw new Error(result.error.message)
      const page = result.value.events.map(row => row.event)
      const cursor = Math.min(...page.flatMap(event => typeof event.seq === 'number' ? [event.seq] : []))
      if (result.value.hasMore && (!Number.isFinite(cursor) || (beforeSeq !== undefined && cursor >= beforeSeq))) {
        throw new Error(props.zh ? '消息分页未前进，请重试。' : 'History pagination did not advance. Please retry.')
      }
      setEvents(current => beforeSeq === undefined ? page : [...page, ...current])
      setHasMore(result.value.hasMore)
    }).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => { controller.abort() }
  }, [props.runtime, props.agentId, props.sessionId, props.zh, beforeSeq, request])
  const messages = events.flatMap(event => {
    const row = message(event)
    return row === null || row.text.trim() === '' ? [] : [{ ...row, seq: event.seq }]
  })
  const labels = props.zh
    ? { user: '你', assistant: '智能体', tool: '工具', error: '运行失败' }
    : { user: 'You', assistant: 'Agent', tool: 'Tool', error: 'Run failed' }
  return <section data-paimind-test-transcript aria-label={props.zh ? '测试消息记录' : 'Test messages'}>
    <header><div><strong>{props.title}</strong><p>{props.zh ? '消息记录 · 只读' : 'Message history · Read only'}</p></div><button type="button" data-paimind-agent-button onClick={props.close}>{props.zh ? '返回当前测试' : 'Return to current test'}</button></header>
    <div data-paimind-test-transcript-messages>
      {hasMore && <button type="button" data-paimind-agent-button disabled={loading} onClick={() => {
        setBeforeSeq(Math.min(...events.flatMap(event => typeof event.seq === 'number' ? [event.seq] : [])))
      }}>{props.zh ? '加载更早消息' : 'Load earlier messages'}</button>}
      {loading && <p role="status">{props.zh ? '正在读取消息…' : 'Loading messages…'}</p>}
      {error !== null && <div role="alert"><p>{error}</p><button type="button" data-paimind-agent-button onClick={() => { setRequest(value => value + 1) }}>{props.zh ? '重试读取' : 'Retry loading'}</button></div>}
      {!loading && error === null && messages.length === 0 && <p>{props.zh ? '这条测试还没有消息。' : 'This test has no messages yet.'}</p>}
      {messages.map((row, index) => <article key={row.seq ?? index} data-role={row.role}><strong>{labels[row.role]}</strong>{row.role === 'tool' ? <details><summary>{props.zh ? '查看工具记录' : 'View tool record'}</summary><pre>{row.text}</pre></details> : <pre>{row.text}</pre>}</article>)}
    </div>
  </section>
}
