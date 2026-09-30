import { serverResponseSchema } from '@deepseek-ai/dsh-host-apiproxy/api/rpc.schema'
import { sessionCreateRequestSchema, sessionCreateValueSchema } from '@deepseek-ai/dsh-host-apiproxy/api/sessions.schema'
import { workspaceListValueSchema } from '@deepseek-ai/dsh-host-apiproxy/api/workspace.schema'

export interface HarnessSessionCreation { sessionId: string; workspaceId: string; presetId: string }
const id = (value: string) => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f]/u.test(value)
export function prepareHarnessSessionCreation(input: HarnessSessionCreation, rpcId: string) {
  if (![input.sessionId, input.workspaceId, input.presetId, rpcId].every(id)) throw Error('Invalid native creation identity')
  const payload = sessionCreateRequestSchema.parse({ sessionId: input.sessionId, workspaceId: input.workspaceId, agentPreset: input.presetId })
  return { path: '/api/session.create', body: JSON.stringify({ type: 'client-request', rpcId, method: 'session.create', payload }),
    verify(text: string): boolean {
      const reply = serverResponseSchema.parse(JSON.parse(text))
      if (reply.rpcId !== rpcId) throw Error('Uncorrelated native creation')
      if (!reply.result.ok) return false // Partial create/attach failures are not proof of no effect.
      const value = sessionCreateValueSchema.parse(reply.result.value)
      if (value.sessionId !== input.sessionId || value.agentPreset !== input.presetId) throw Error('Native creation identity changed')
      return true
    } }
}

/** Original workspace owner only. Do not export paths or construct a second
 * workspace/session membership registry in the enterprise control plane. */
export function prepareHarnessSessionWorkspaceRead(workspaceId: string, sessionId: string, rpcId: string) {
  if (![workspaceId, sessionId, rpcId].every(id)) throw Error('Invalid native workspace selection')
  return { path: '/api/workspace.list', body: JSON.stringify({ type: 'client-request', rpcId, method: 'workspace.list', payload: {} }),
    decode(text: string): { exists: boolean; attached: boolean } {
      const reply = serverResponseSchema.parse(JSON.parse(text))
      if (reply.rpcId !== rpcId || !reply.result.ok) throw Error('Native workspace read unavailable')
      const value = workspaceListValueSchema.parse(reply.result.value)
      if (value.items.length > 1000 || new Set(value.items.map(item => item.workspaceId)).size !== value.items.length
        || value.items.some(item => item.sessionIds.length > 10000 || new Set(item.sessionIds).size !== item.sessionIds.length)) throw Error('Invalid native workspace membership')
      const workspace = value.items.find(item => item.workspaceId === workspaceId)
      return { exists: workspace !== undefined, attached: workspace?.sessionIds.some(id => id === sessionId) ?? false }
    } }
}
