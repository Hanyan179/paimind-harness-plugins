import type { AgentProfileSnapshot } from '@hansen/agent-builder'
import type { HarnessAgentPresetConnection, HarnessRemoteResult } from '@hansen/harness-compat'
import type { McpConnectionSummary, McpSummaryReader } from '@hansen/mcp-center/contract'

export interface TaskResourceConfiguration {
  readonly sessionId: string
  readonly presetId?: string
  readonly names: Readonly<Record<string, string>>
  readonly avatars?: Readonly<Record<string, string>>
  readonly skillNames: readonly string[]
  readonly connectionIds: readonly string[]
  readonly connections: readonly McpConnectionSummary[]
  readonly profiles: 'ready' | 'unavailable' | 'error'
  readonly mcps: 'ready' | 'unavailable' | 'error'
}

export type TaskResourceReader = (sessionId: string, presetId?: string) => Promise<TaskResourceConfiguration>
type ProfileReader = { listProfiles(): Promise<HarnessRemoteResult<AgentProfileSnapshot>> }
type ConnectionReader = { summarizeSession(input: { sessionId: string }): Promise<HarnessRemoteResult<Awaited<ReturnType<McpSummaryReader['summarizeSession']>>>> }

function value<T>(result: HarnessRemoteResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

/** Optional source-owned contracts. No profile, binding, or connection is copied to storage. */
export function taskResourceReader(ctx: { get?(name: string): unknown }): TaskResourceReader {
  const get = <T,>(name: string): T | undefined => { try { return ctx.get?.(name) as T | undefined } catch { return undefined } }
  return async (sessionId, presetId) => {
    const profiles = get<ProfileReader>('remote.paimindAgentProfiles')
    const mcps = get<ConnectionReader>('remote.paimindMcpConnections')
    const presets = get<HarnessAgentPresetConnection>('connection')?.api.agentPresets
    const [profileResult, mcpResult, rosterResult] = await Promise.allSettled([
      typeof profiles?.listProfiles === 'function' ? profiles.listProfiles().then(value) : undefined,
      typeof mcps?.summarizeSession === 'function' ? mcps.summarizeSession({ sessionId }).then(value) : undefined,
      typeof presets?.list === 'function' ? presets.list({}).then(result => value(result.result)) : undefined,
    ])
    const profile = profileResult.status === 'fulfilled' ? profileResult.value?.profiles.find(row => row.presetId === presetId) : undefined
    const names: Record<string, string> = {}
    const avatars: Record<string, string> = {}
    if (rosterResult.status === 'fulfilled') for (const row of rosterResult.value?.presets ?? []) if (row.name?.trim()) names[row.id] = row.name
    if (profileResult.status === 'fulfilled') for (const row of profileResult.value?.profiles ?? []) {
      names[row.presetId] = row.name
      if (row.avatarId !== undefined) avatars[row.presetId] = row.avatarId
    }
    return {
      sessionId, ...(presetId === undefined ? {} : { presetId }), names, avatars,
      skillNames: profile?.preferredSkillNames ?? [], connectionIds: profile?.connectionIds ?? [],
      connections: mcpResult.status === 'fulfilled' ? mcpResult.value?.items ?? [] : [],
      profiles: profileResult.status === 'rejected' ? 'error' : profileResult.value === undefined ? 'unavailable' : 'ready',
      mcps: mcpResult.status === 'rejected' ? 'error' : mcpResult.value === undefined ? 'unavailable' : 'ready',
    }
  }
}

export interface CapabilityValue { readonly key: string; readonly text: string; readonly status: string }

export function taskCapabilities(view: { skills: readonly string[]; mcps: readonly { server: string; status: string }[] }, config: TaskResourceConfiguration | undefined, zh: boolean): { skills: CapabilityValue[]; mcps: CapabilityValue[] } {
  const skills = [...new Set([...(config?.skillNames ?? []), ...view.skills])].map(name => {
    const bound = config?.skillNames.includes(name) === true, used = view.skills.includes(name)
    return { key: name, text: name, status: [bound ? (zh ? '已挂载' : 'Configured') : '', used ? (zh ? '已加载' : 'Loaded') : ''].filter(Boolean).join(' · ') }
  })
  const usedServers = new Set(view.mcps.filter(row => row.status === 'used').map(row => row.server))
  const rows: CapabilityValue[] = []
  for (const item of config?.connections ?? []) {
    const bound = config?.connectionIds.includes(item.id), used = usedServers.has(item.server)
    if (!bound && !used) continue
    usedServers.delete(item.server)
    rows.push({ key: item.id, text: item.name, status: [
      bound ? (zh ? '已挂载' : 'Configured') : '',
      !item.enabled ? (zh ? '已停用' : 'Disabled') : bound && !item.mounted ? (zh ? '本会话未就绪' : 'Not ready in this session') : '',
      used ? (zh ? '已使用' : 'Used') : '',
    ].filter(Boolean).join(' · ') })
  }
  for (const id of config?.connectionIds ?? []) if (!config?.connections.some(item => item.id === id)) {
    rows.push({ key: id, text: zh ? '工具连接（名称不可用）' : 'Connection (name unavailable)', status: config?.mcps === 'ready' ? (zh ? '引用已失效' : 'Missing reference') : (zh ? '状态不可用' : 'Status unavailable') })
  }
  for (const server of usedServers) rows.push({ key: server, text: /^paimind_[a-f0-9]{20}$/.test(server) ? (zh ? '工具连接（名称不可用）' : 'Connection (name unavailable)') : server, status: zh ? '已使用' : 'Used' })
  return { skills, mcps: rows }
}
