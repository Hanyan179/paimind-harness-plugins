export interface AgentAuthoringDraftContext {
  readonly productKind: 'personal' | 'business'
  readonly businessCategory: string
  readonly name: string
  readonly description: string
  readonly basePresetId: string
  readonly role: string
  readonly goal: string
  readonly behavior: string
  readonly instructions: string
  readonly preferredSkillNames: readonly string[]
}

export interface AgentAuthoringProposal {
  readonly businessCategory?: string
  readonly name?: string
  readonly description?: string
  readonly role?: string
  readonly goal?: string
  readonly behavior?: string
  readonly instructions?: string
  readonly preferredSkillNames?: readonly string[]
}

export interface AgentAuthoringTurnResult {
  readonly sessionId: string
  readonly turn: number
  readonly endSeq: number
  readonly text: string
  readonly proposal: AgentAuthoringProposal | null
}

export interface AgentAuthoringResumeSnapshot {
  readonly sessionId: string
  readonly draft: Readonly<AgentAuthoringDraftContext>
  readonly cursor: number
}

export interface AgentAuthoringWatchCallbacks {
  readonly onRunning?: () => void
  readonly onIdle?: () => void
  readonly onTurn: (result: Readonly<AgentAuthoringTurnResult>) => void | Promise<void>
  readonly onError: (error: Error) => void
}

const AUTHORING_DRAFT_BLOCK = /<!--\s*PAIMIND_AGENT_DRAFT\s*\n?([\s\S]*?)\s*-->/gi

export function assistantTextFromHistoryEvent(event: { readonly type: string; readonly data?: unknown }): string {
  if (event.type !== 'assistant/message' || typeof event.data !== 'object' || event.data === null) return ''
  const data = event.data as { readonly message?: { readonly content?: unknown } }
  if (!Array.isArray(data.message?.content)) return ''
  return data.message.content
    .filter((block): block is { readonly type: 'text'; readonly text: string } => (
      typeof block === 'object' && block !== null
      && (block as { readonly type?: unknown }).type === 'text'
      && typeof (block as { readonly text?: unknown }).text === 'string'
    ))
    .map(block => block.text)
    .join('\n')
    .trim()
}

export function parseAuthoringTurn(text: string): { readonly text: string; readonly proposal: AgentAuthoringProposal | null } {
  const matches = [...text.matchAll(AUTHORING_DRAFT_BLOCK)]
  if (matches.length === 0) {
    if (/PAIMIND_AGENT_DRAFT/i.test(text)) throw new Error('Harness cordis 返回的说明书提案不完整')
    return Object.freeze({ text: text.trim(), proposal: null })
  }
  const match = matches[0]
  const payload = match?.[1]
  if (matches.length !== 1 || match === undefined || payload === undefined) throw new Error('Harness cordis 每轮只能返回一份说明书提案')
  let parsed: unknown
  try { parsed = JSON.parse(payload) } catch { throw new Error('Harness cordis 返回的说明书提案不是有效 JSON') }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Harness cordis 返回的说明书提案必须是 JSON 对象')
  const record = parsed as Readonly<Record<string, unknown>>
  const allowed = new Set(['businessCategory', 'name', 'description', 'role', 'goal', 'behavior', 'instructions', 'preferredSkillNames'])
  const unknown = Object.keys(record).filter(key => !allowed.has(key))
  if (unknown.length > 0) throw new Error(`Harness cordis 返回了不允许修改的字段：${unknown.join('、')}`)
  const proposal: Record<string, string | readonly string[]> = {}
  for (const key of ['businessCategory', 'name', 'description', 'role', 'goal', 'behavior', 'instructions'] as const) {
    if (record[key] === undefined) continue
    if (typeof record[key] !== 'string') throw new Error(`Harness cordis 返回的 ${key} 字段类型无效`)
    proposal[key] = record[key]
  }
  if (record.preferredSkillNames !== undefined) {
    if (!Array.isArray(record.preferredSkillNames) || !record.preferredSkillNames.every(value => typeof value === 'string')) {
      throw new Error('Harness cordis 返回的 preferredSkillNames 字段类型无效')
    }
    proposal.preferredSkillNames = record.preferredSkillNames
  }
  const visibleText = text.replace(match[0], '').trim()
  if (/PAIMIND_AGENT_DRAFT/i.test(visibleText)) throw new Error('Harness cordis 返回的说明书提案标记不完整')
  const safeVisibleText = /[?？]/u.test(visibleText) ? '' : visibleText
  return Object.freeze({ text: safeVisibleText, proposal: Object.freeze(proposal) as AgentAuthoringProposal })
}

export function validateAuthoringProposal(
  proposal: AgentAuthoringProposal | null,
  installedSkills: readonly { readonly name: string }[],
): AgentAuthoringProposal | null {
  if (proposal?.preferredSkillNames === undefined) return proposal
  const installed = new Set(installedSkills.map(skill => skill.name))
  const requested = [...new Set(proposal.preferredSkillNames.map(name => name.trim()))]
  const available = requested.filter(name => name !== '' && installed.has(name))
  return Object.freeze({ ...proposal, preferredSkillNames: Object.freeze(available) })
}

export function mergeAuthoringDraftContext(
  draft: Readonly<AgentAuthoringDraftContext>,
  proposal: AgentAuthoringProposal | null,
): Readonly<AgentAuthoringDraftContext> {
  if (proposal === null) return draft
  return Object.freeze({
    ...draft,
    ...(proposal.businessCategory === undefined || draft.productKind !== 'business' ? {} : { businessCategory: proposal.businessCategory }),
    ...(proposal.name === undefined ? {} : { name: proposal.name }),
    ...(proposal.description === undefined ? {} : { description: proposal.description }),
    ...(proposal.role === undefined ? {} : { role: proposal.role }),
    ...(proposal.goal === undefined ? {} : { goal: proposal.goal }),
    ...(proposal.behavior === undefined ? {} : { behavior: proposal.behavior }),
    ...(proposal.instructions === undefined ? {} : { instructions: proposal.instructions }),
    ...(proposal.preferredSkillNames === undefined ? {} : { preferredSkillNames: proposal.preferredSkillNames }),
  })
}

export function historySeq(event: { readonly seq?: number }): number { return typeof event.seq === 'number' ? event.seq : -1 }

export function turnEndReason(event: { readonly type: string; readonly data?: unknown }): string | null {
  if (event.type !== 'turn/end' || typeof event.data !== 'object' || event.data === null) return null
  const reason = (event.data as { readonly reason?: { readonly kind?: unknown } }).reason?.kind
  return typeof reason === 'string' ? reason : null
}

export function historyTurn(event: { readonly type: string; readonly data?: unknown }, type: 'turn/start' | 'turn/end'): number | null {
  if (event.type !== type || typeof event.data !== 'object' || event.data === null) return null
  const turn = (event.data as { readonly turn?: unknown }).turn
  return typeof turn === 'number' && Number.isInteger(turn) ? turn : null
}

export function authoringPromptRpcId(event: { readonly type: string; readonly data?: unknown }): string | null {
  if (event.type !== 'user/message' || typeof event.data !== 'object' || event.data === null) return null
  const source = (event.data as { readonly source?: { readonly kind?: unknown; readonly rpcId?: unknown } }).source
  return source?.kind === 'user' && typeof source.rpcId === 'string' ? source.rpcId : null
}

export function authoringInboxMessageId(event: { readonly type: string; readonly data?: unknown }, rpcId: string): string | null {
  if (event.type !== 'agent/inbox/spliced' || typeof event.data !== 'object' || event.data === null) return null
  const inserted = (event.data as { readonly inserted?: unknown }).inserted
  if (!Array.isArray(inserted)) return null
  for (const candidate of inserted) {
    if (typeof candidate !== 'object' || candidate === null) continue
    const message = candidate as { readonly id?: unknown; readonly source?: { readonly kind?: unknown; readonly rpcId?: unknown } }
    if (message.source?.kind === 'user' && message.source.rpcId === rpcId && typeof message.id === 'string') return message.id
  }
  return null
}

export function assistantTurn(event: { readonly type: string; readonly data?: unknown }): number | null {
  if (event.type !== 'assistant/message' || typeof event.data !== 'object' || event.data === null) return null
  const turn = (event.data as { readonly turn?: unknown }).turn
  return typeof turn === 'number' && Number.isInteger(turn) ? turn : null
}

export function correlateAuthoringTurn(
  events: readonly { readonly type: string; readonly seq?: number; readonly data?: unknown }[],
  rpcId: string,
): { readonly turn: number; readonly userSeq: number } | null {
  let openTurn: number | null = null
  for (const event of [...events].sort((left, right) => historySeq(left) - historySeq(right))) {
    const started = historyTurn(event, 'turn/start')
    if (started !== null) openTurn = started
    if (authoringPromptRpcId(event) === rpcId) {
      const userSeq = historySeq(event)
      if (openTurn === null || userSeq < 0) throw new Error('Harness cordis 创建消息缺少原生 Turn 边界')
      return Object.freeze({ turn: openTurn, userSeq })
    }
    const ended = historyTurn(event, 'turn/end')
    if (ended !== null && ended === openTurn) openTurn = null
  }
  return null
}

export function hasAuthoringTurnCollision(
  events: readonly { readonly type: string; readonly seq?: number; readonly data?: unknown }[],
  target: { readonly turn: number; readonly userSeq: number },
  rpcId: string,
): boolean {
  let openTurn: number | null = null
  for (const event of [...events].sort((left, right) => historySeq(left) - historySeq(right))) {
    const started = historyTurn(event, 'turn/start')
    if (started !== null) openTurn = started
    if (openTurn === target.turn && event.type === 'user/message') {
      const otherRpcId = authoringPromptRpcId(event)
      if (otherRpcId !== null && otherRpcId !== rpcId) return true
    }
    const ended = historyTurn(event, 'turn/end')
    if (ended !== null && ended === openTurn) openTurn = null
  }
  return false
}

export function turnEndFailure(event: { readonly type: string; readonly data?: unknown }): string {
  const reason = turnEndReason(event) ?? 'unknown'
  if (reason !== 'error' || typeof event.data !== 'object' || event.data === null) return reason
  const message = (event.data as { readonly reason?: { readonly error?: { readonly message?: unknown } } }).reason?.error?.message
  return typeof message === 'string' && message.trim() !== '' ? `${reason}: ${message.trim()}` : reason
}

export function visibleAuthoringPartial(blocks: readonly { readonly kind: string; readonly text?: string }[]): string {
  const text = blocks
    .filter((block): block is { readonly kind: 'text'; readonly text: string } => block.kind === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
  const marker = '<PAIMIND_AGENT_DRAFT>'
  const upper = text.toLocaleUpperCase()
  let cut = upper.indexOf(marker)
  if (cut < 0) {
    for (let length = marker.length - 1; length > 0; length -= 1) {
      if (upper.endsWith(marker.slice(0, length))) { cut = text.length - length; break }
    }
  }
  return text.slice(0, cut < 0 ? text.length : cut).trim()
}
