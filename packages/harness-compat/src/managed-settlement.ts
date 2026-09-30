import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import { foldConsumedWork, type Agent } from '@deepseek-ai/dsh-agent'
import { finalAssistantOutput, foldSubagentDescriptor } from '@deepseek-ai/dsh-subagent'
import { boundContextSummary, type ContentBlock, type UserMessage } from '@deepseek-ai/dsh-llm'
import { executionScope } from './managed-origins.js'

type Method = 'followup' | 'steer' | 'inject'
type Send = Agent[Method]
type Claim = { message: UserMessage; turn: number }
type Discard = { message: UserMessage; index: number }
type Epoch = { child: Agent; parent: Agent; runId: string; boundary: number; claims: Claim[]; discarded: Discard[];
  version: number; proof?: { sources: readonly string[]; length: number; presetId: string; output: ContentBlock[] | undefined } }
type Wrapper = { send: Send; original: Send; descriptor: PropertyDescriptor | undefined }
const failure = () => new Error('子任务结束通知的原生来源无法确认，通知未获得执行权限')

/** Only an in-flight provenance projection of original native epochs/messages.
 * This owns no Session, lineage, transcript, inbox, residency or wake-up rule.
 * Signing joins the original awaited final flush. The original manager still
 * builds and sends its notice AFTER handle disposal and BEFORE subagent/end. */
export function installManagedHarnessSettlements(context: Context, root: Context,
  derive: (child: Agent, messages: readonly UserMessage[], parent: Agent, signal: AbortSignal) => Promise<readonly string[]>,
  ownsFollowup: (parent: Agent, send: Send) => boolean) {
  const epochs = new Map<Agent, Epoch>(), wrappers = new Map<Agent, Map<Method, Wrapper>>()
  const lifetime = new AbortController()
  const restore = (parent: Agent) => {
    const owned = wrappers.get(parent)
    if (!owned) return
    wrappers.delete(parent)
    for (const [method, wrapper] of owned) if (parent[method] === wrapper.send) {
      if (wrapper.descriptor) Object.defineProperty(parent, method, wrapper.descriptor)
      else Reflect.deleteProperty(parent, method)
    }
  }
  const hasPending = (parent: Agent) => [...epochs.values()].some(epoch => epoch.parent === parent && epoch.proof
    && root.agents.get(epoch.child.id) !== epoch.child)
  const forget = (epoch: Epoch) => {
    epochs.delete(epoch.child); epoch.version++; delete epoch.proof
    if (!hasPending(epoch.parent)) restore(epoch.parent)
  }
  context.effect(() => () => {
    lifetime.abort(); epochs.clear()
    for (const parent of [...wrappers.keys()]) restore(parent)
  })
  context.on('subagent/start', info => {
    if (!info.local || lifetime.signal.aborted) return
    const child = root.agents.get(info.id)
    if (!child || foldSubagentDescriptor(child.session.events)?.mode !== 'continuable') return
    const parentId = child.session.header.parentSession, parent = parentId && root.agents.get(parentId)
    if (!parent || child.ctx.root !== root || child.session.header.origin !== 'subagent' || epochs.has(child)) return
    epochs.set(child, { child, parent, runId: info.runId, boundary: child.session.events.length,
      claims: [], discarded: [], version: 0 })
  })
  context.on('agent/inbox/claimed', ({ agent, message, turn }) => {
    epochs.get(agent)?.claims.push({ message, turn })
  })
  context.on('agent/inbox/discarded', ({ agent, message }) => {
    const index = agent.session.events.length - 1, event = agent.session.events[index]
    // A replacement splice can discard superseded input without canceling
    // work. Only the original fold's unrun-cancellation shape contributes.
    if (event?.type === 'agent/inbox/spliced' && event.data.outcome === 'canceled' && event.data.inserted.length === 0)
      epochs.get(agent)?.discarded.push({ message, index })
  })
  context.on('session/flush', async session => {
    const child = root.agents.get(session.id), epoch = child && epochs.get(child)
    if (!child || !epoch || child.session !== session || child.status !== 'idle') return
    delete epoch.proof
    const version = ++epoch.version, own = session.events.slice(epoch.boundary), length = session.events.length
    const consumed = foldConsumedWork(own), output = finalAssistantOutput(own)
    const turns = new Set<number>()
    if (consumed.end) turns.add(consumed.end.data.turn)
    // Use the native output fold, not a copied transcript/result algorithm.
    // Its last full message can precede a later failed/unstarted turn. Include
    // BOTH the closing-output origin and the terminal work's origin.
    let turn: number | undefined, fullOutputTurn: number | undefined
    const partialTurns = new Set<number>(), accepted: Claim[] = []
    for (const event of own) {
      if (event.type === 'turn/start') turn = event.data.turn
      if (event.type === 'user/message' && turn !== undefined) accepted.push({ turn, message: event.data })
      if (event.type === 'assistant/message' && event.data.message.content === output) fullOutputTurn = turn
      if (event.type === 'assistant/chunk' && event.data.chunk.type === 'text-delta' && event.data.chunk.text && turn !== undefined) partialTurns.add(turn)
      if (event.type === 'turn/end') turn = undefined
    }
    if (output !== undefined) {
      if (fullOutputTurn !== undefined) turns.add(fullOutputTurn)
      else for (const value of partialTurns) turns.add(value)
    }
    const messages = new Set<UserMessage>()
    for (const claim of [...accepted, ...epoch.claims]) if (turns.has(claim.turn)) messages.add(claim.message)
    if (consumed.droppedUnrun) {
      const endIndex = consumed.end ? session.events.indexOf(consumed.end) : epoch.boundary - 1
      for (const discard of epoch.discarded) if (discard.index > endIndex) messages.add(discard.message)
    }
    if (!messages.size) throw failure()
    const parent = epoch.parent, preset = executionScope(child).presetId
    const assertTarget = () => {
      if (lifetime.signal.aborted || epochs.get(child) !== epoch || epoch.version !== version
        || child.status !== 'idle' || child.session.events.length !== length || root.agents.get(child.id) !== child
        || root.agents.get(parent.id) !== parent || child.session.header.parentSession !== parent.id
        || !preset || executionScope(child).presetId !== preset || executionScope(parent).presetId !== preset) throw failure()
    }
    assertTarget()
    const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(4000)])
    const sources = await derive(child, [...messages], parent, signal)
    signal.throwIfAborted(); assertTarget()
    epoch.proof = { sources, length, presetId: preset!, output }
  })
  const install = (parent: Agent) => {
    if (wrappers.has(parent)) return
    const owned = new Map<Method, Wrapper>()
    for (const method of ['followup', 'steer', 'inject'] as const) {
      const original = parent[method], descriptor = Object.getOwnPropertyDescriptor(parent, method)
      // Only the known continuation contribution may already own a method.
      // Unknown adapters retain their exact descriptor; do not sign through
      // an unverified competing sender or partially install the other hooks.
      if (typeof original !== 'function' || descriptor && (!descriptor.configurable || descriptor.value !== original
        || method !== 'followup' || !ownsFollowup(parent, original))) return
      const send: Send = function (this: Agent, message: UserMessage) {
        if (message.source.kind !== 'subagent-settled') return original.call(this, message)
        const source = message.source as unknown as Record<string, unknown>
        const epoch = [...epochs.values()].find(value => value.parent === parent && value.child.id === source.senderSessionId)
        const proof = epoch?.proof
        if (this !== parent || parent[method] !== send || lifetime.signal.aborted || !epoch || !proof
          || root.agents.get(parent.id) !== parent || root.agents.get(epoch.child.id) !== undefined
          || epoch.child.session.events.length !== proof.length
          || executionScope(parent).presetId !== proof.presetId
          || Object.keys(source).sort().join(',') !== 'form,kind,senderSessionId,summary' || source.form !== 'notice'
          || message.content[0]?.type !== 'text' || !message.content[0].text.startsWith(`Background subagent ${epoch.child.id} `)
          || source.summary !== boundContextSummary(message.content[0].text)
          || message.content[1]?.type !== 'text') throw failure()
        const noOutput = message.content[1].text === 'It left no closing message.' && message.content.length === 2
        const withOutput = message.content[1].text === 'Its closing message:' && proof.output !== undefined
          && isDeepStrictEqual(message.content.slice(2), proof.output)
        if (!noOutput && !withOutput) throw failure()
        // Consume BEFORE sending: native wake-up can execute synchronously and
        // may re-enter another adapter. Restore exact prior method ownership.
        forget(epoch)
        return original.call(parent, { ...message, source: Object.freeze({ ...message.source, paimindOrigins: proof.sources }) })
      }
      owned.set(method, { send, original, descriptor })
    }
    wrappers.set(parent, owned)
    for (const [method, wrapper] of owned) Object.defineProperty(parent, method, { value: wrapper.send, writable: true, configurable: true })
  }
  context.on('agent/disposed', ({ agent }) => {
    // AgentLoop disposes the child's scope BEFORE registry detachment. Waiting
    // for this original edge avoids holding a child-scoped hook past cleanup.
    for (const epoch of [...epochs.values()]) if (epoch.parent === agent) forget(epoch)
    restore(agent)
    const epoch = epochs.get(agent)
    if (epoch?.proof && !lifetime.signal.aborted) install(epoch.parent)
  })
  context.on('subagent/end', info => {
    for (const epoch of epochs.values()) if (epoch.runId === info.runId && epoch.child.id === info.id) { forget(epoch); break }
  })
  return {
    owns(parent: Agent, method: Method, send: Send) { return wrappers.get(parent)?.get(method)?.send === send },
    current(parent: Agent, method: Method, send: Send) {
      const wrapper = wrappers.get(parent)?.get(method)
      return parent[method] === send || parent[method] === wrapper?.send && wrapper.original === send
    },
  }
}
