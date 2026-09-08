import { isAbsolute, relative, resolve, sep } from 'node:path'
import type {
  PaimindHostAgent,
  PaimindHostWorkspaceRegistry,
  PaimindToolRunContext,
} from './host.js'
import {
  resolvePaimindLiveAgentPreset,
  type PaimindScopedSkillAgent,
} from './host.js'
export interface PaimindContextAccessHost {
  get(name: string): unknown
  readonly agents: { list(): readonly PaimindHostAgent[] }
  readonly sessions: {
    get(id: string): PaimindHostAgent['session'] | undefined
  }
  readonly workspaceRegistry: PaimindHostWorkspaceRegistry
}
export function paimindContextSession(
  host: PaimindContextAccessHost,
  id: string,
): {
  agent: PaimindHostAgent | undefined
  session: PaimindHostAgent['session']
  workspace:
    | ReturnType<PaimindHostWorkspaceRegistry['list']>[number]
    | undefined
  presetId: string | undefined
} {
  const agent = host.agents.list().find((a) => a.session.id === id)
  const session = agent?.session ?? host.sessions.get(id)
  if (!session) throw new Error('宿主会话不存在或尚未加载')
  const workspace = host.workspaceRegistry
    .list()
    .find((w) => w.sessionIds.includes(id))
  const presetId =
    agent && 'ctx' in agent
      ? resolvePaimindLiveAgentPreset(agent as PaimindScopedSkillAgent)
      : session.header.agentPreset
  return { agent, session, workspace, presetId }
}
/** Source grants do not widen the native file-effect policy. An outside-root mutation returns a denial for the user to resolve in native permissions. */
export async function assertPaimindContextMutation(
  host: PaimindContextAccessHost,
  exec: PaimindToolRunContext,
  targetRoot: string,
): Promise<void> {
  const agent = exec.agent
  if (!agent) throw new Error('缺少宿主调用身份')
  const policy = host.get('sandboxPolicy') as
    | {
        resolve(input: { session: PaimindHostAgent['session'] }): {
          mode: string
          workspaceRoot: string
        }
      }
    | undefined
  if (!policy) throw new Error('SANDBOX_UNAVAILABLE: 宿主文件权限不可用')
  const current = policy.resolve({ session: agent.session })
  if (current.mode === 'danger-full-access') return
  const edge = relative(resolve(current.workspaceRoot), resolve(targetRoot))
  if (
    current.mode === 'workspace-write' &&
    !isAbsolute(edge) &&
    edge !== '..' &&
    !edge.startsWith(`..${sep}`)
  )
    return
  throw new Error(
    'ACCESS_DENIED: 此写入超出当前宿主文件权限；请在宿主权限设置中授权后重试',
  )
}
export function requirePaimindContextCaller(
  host: PaimindContextAccessHost,
  exec: PaimindToolRunContext,
): string {
  if (!exec.agent || !host.agents.list().includes(exec.agent))
    throw new Error('无效的宿主工具调用身份')
  return exec.agent.session.id
}

export interface PaimindContextSkillHost extends PaimindContextAccessHost {
  readonly on: {
    (
      event: 'agent/created' | 'agent/disposed',
      listener: (payload: { agent: PaimindHostAgent }) => void,
    ): () => void
    (
      event: 'agent/pre-step',
      listener: (
        payload: { agent: PaimindHostAgent },
        next: () => Promise<unknown>,
      ) => Promise<unknown>,
    ): () => void
  }
}
/** A source-owned, dynamically scoped catalog. Contents are resolved on native reads. */
export function installPaimindContextSkill(
  host: PaimindContextSkillHost,
  provider: string,
  resolveDefinition: (
    sessionId: string,
  ) => Promise<
    { name: string; description: string; content: string } | undefined
  >,
): () => void {
  const installed = new Map<PaimindHostAgent, () => void>()
  const refresh = new Map<PaimindHostAgent, () => void>()
  let active = true
  const attach = (agent: PaimindHostAgent) => {
    if (!('ctx' in agent) || installed.has(agent)) return
    const registry = (agent as PaimindScopedSkillAgent).ctx.get('skills')
    if (!registry) return
    const candidate = async () => {
      if (!active) return undefined
      const definition = await resolveDefinition(agent.session.id)
      if (!definition) return undefined
      return {
        ...definition,
        provider,
        source: 'custom' as const,
        rank: 100,
        locator: provider + ':' + agent.session.id,
        invocation: { modelInvocable: true, userInvocable: true },
      }
    }
    installed.set(
      agent,
      registry.registerProvider((control) => {
        refresh.set(agent, () => control.invalidate())
        return {
          name: provider,
          list: async () => {
            const d = await candidate()
            return d ? [d] : []
          },
          get: async (c) => {
            const d = await candidate()
            return d && c.name === d.name ? d : undefined
          },
        }
      }),
    )
  }
  for (const agent of host.agents.list()) attach(agent)
  const created = host.on('agent/created', ({ agent }) => attach(agent))
  const disposed = host.on('agent/disposed', ({ agent }) => {
    installed.get(agent)?.()
    installed.delete(agent)
    refresh.delete(agent)
  })
  const preStep = host.on('agent/pre-step', async ({ agent }, next) => {
    attach(agent)
    refresh.get(agent)?.()
    return next()
  })
  return () => {
    active = false
    preStep()
    created()
    disposed()
    refresh.clear()
    for (const dispose of installed.values()) dispose()
    installed.clear()
  }
}
