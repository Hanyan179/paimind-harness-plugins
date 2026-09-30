import { serverResponseSchema } from '@deepseek-ai/dsh-host-apiproxy/api/rpc.schema'
import { sessionHistoryValueSchema } from '@deepseek-ai/dsh-host-apiproxy/api/sessions.schema'
import { workspaceListValueSchema } from '@deepseek-ai/dsh-host-apiproxy/api/workspace.schema'

const textId = (value: string) => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f]/u.test(value)
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid native produced-file fact')
  return value as Record<string, unknown>
}
function response(text: string, rpcId: string): unknown {
  if (new TextEncoder().encode(text).length > 2 * 1024 * 1024) throw Error('Native artifact read exceeds bound')
  const reply = serverResponseSchema.parse(JSON.parse(text))
  if (reply.rpcId !== rpcId || !reply.result.ok) throw Error('Native artifact read unavailable')
  return reply.result.value
}

/** Read-only transport facts, not a persistent deliverables registry or a file existence check. */
export interface HarnessProducedFileFact { readonly path: string; readonly seq: number; readonly time: number }
export interface HarnessSessionProducedRead {
  readonly asOfSeq: number
  readonly produced: readonly HarnessProducedFileFact[]
  /** Provider-owned value: the domain consumer must validate its own schema. */
  readonly projection: unknown
}

/** One original tail-history cut supplies both native presenter facts and the
 * requested provider projection. Live and detached reads remain host-owned;
 * this adapter neither resumes an Agent nor folds provider metadata itself. */
export function prepareHarnessSessionProducedRead(sessionId: string, projectionKey: string, rpcId: string) {
  if (![sessionId, projectionKey, rpcId].every(textId)) throw Error('Invalid native artifact selection')
  return { path: '/api/session.history', body: JSON.stringify({ type: 'client-request', rpcId, method: 'session.history',
    payload: { sessionId, maxMessages: 10001 } }),
  decode(text: string): HarnessSessionProducedRead {
    const page = sessionHistoryValueSchema.parse(response(text, rpcId)) as unknown as {
      events: Array<{ event: { seq: number; time: number; type: string; data: unknown; surfaceOp?: string };
        view?: { for: string; view: Record<string, unknown> } }>
      hasMore: boolean; projections?: { asOfSeq: number; values: Record<string, unknown> }
    }
    if (page.hasMore || page.events.length > 10000 || !page.projections) throw Error('Incomplete native artifact history')
    const turns = new Map<number, Map<string, readonly string[]>>()
    const produced: HarnessProducedFileFact[] = []
    let previous = -1
    for (const { event, view } of page.events) {
      if (!Number.isSafeInteger(event.seq) || event.seq <= previous || !Number.isFinite(event.time)) throw Error('Invalid native artifact order')
      previous = event.seq
      if (!['turn/start', 'tool/call', 'tool/result'].includes(event.type)) continue
      // Root tool/call plus successful append tool/result is the selected
      // native presenter contract. Reads, deletes, nested dispatch, model
      // prose and generic terminal output never imply produced files.
      const data = record(event.data), turn = data.turn
      if (!Number.isSafeInteger(turn) || (turn as number) < 0) throw Error('Invalid native artifact turn')
      if (event.type === 'turn/start') {
        if (turns.has(turn as number)) throw Error('Duplicate native artifact turn')
        turns.set(turn as number, new Map()); continue
      }
      const calls = turns.get(turn as number)
      if (!calls) throw Error('Missing native artifact turn')
      if (event.type === 'tool/call') {
        const callId = data.callId
        if (typeof callId !== 'string' || !textId(callId) || calls.has(callId)) throw Error('Invalid native artifact call')
        const card = view?.for === 'call' ? view.view : undefined
        let paths: string[] = []
        if (card?.card === 'diff' || card?.card === 'generic' && card.kind === 'edit') {
          const locations = card.locations ?? []
          if (!Array.isArray(locations) || locations.length > 1000) throw Error('Invalid native produced locations')
          paths = locations.map(location => {
            const path = record(location).path
            if (typeof path !== 'string' || !path || path.length > 4096 || /[\u0000-\u001f\u007f]/u.test(path)) throw Error('Invalid native produced path')
            return path
          })
        }
        calls.set(callId, paths); continue
      }
      if (event.surfaceOp !== 'append') continue
      const message = record(data.message), content = message.content, source = record(message.source)
      if (!Array.isArray(content) || !content.length || typeof source.callId !== 'string') throw Error('Invalid native result fact')
      const outcome = record(content[0]).isError
      if (outcome !== undefined && typeof outcome !== 'boolean') throw Error('Invalid native result outcome')
      if (outcome === true) continue
      const paths = calls.get(source.callId)
      if (!paths) throw Error('Missing native result call')
      for (const path of paths) produced.push(Object.freeze({ path, seq: event.seq, time: event.time }))
      if (produced.length > 10000) throw Error('Native produced files exceed bound')
    }
    if (page.projections.asOfSeq !== previous) throw Error('Native artifact cut changed')
    return Object.freeze({ asOfSeq: previous, produced: Object.freeze(produced),
      projection: Object.hasOwn(page.projections.values, projectionKey) ? page.projections.values[projectionKey] : undefined })
  } }
}

/** Exact original Workspace membership. No path-derived identity, shadow
 * association or caller-supplied root is accepted. */
export function prepareHarnessSessionArtifactWorkspaceRead(sessionId: string, rpcId: string) {
  if (![sessionId, rpcId].every(textId)) throw Error('Invalid native artifact workspace selection')
  return { path: '/api/workspace.list', body: JSON.stringify({ type: 'client-request', rpcId, method: 'workspace.list', payload: {} }),
    decode(text: string): Readonly<{ workspaceId: string; path: string }> {
      const value = workspaceListValueSchema.parse(response(text, rpcId))
      if (value.items.length > 1000 || new Set(value.items.map(item => item.workspaceId)).size !== value.items.length
        || value.items.some(item => item.sessionIds.length > 10000 || new Set(item.sessionIds).size !== item.sessionIds.length)) throw Error('Invalid native workspace membership')
      const matches = value.items.filter(item => item.sessionIds.some(id => id === sessionId))
      if (matches.length !== 1) throw Error('Native artifact workspace unavailable')
      const workspace = matches[0]!
      if (!textId(workspace.workspaceId) || !workspace.path.startsWith('/') || workspace.path.length > 4096
        || /[\u0000-\u001f\u007f]/u.test(workspace.path)) throw Error('Invalid native artifact workspace')
      return Object.freeze({ workspaceId: workspace.workspaceId, path: workspace.path })
    } }
}
