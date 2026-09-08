import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { PaimindHostRemoteService, markPaimindHostRemoteMethods, resolvePaimindLiveAgentPreset } from '@hansen/harness-compat/host'
import { mountPaimindNativeMcp, probePaimindNativeMcp, refreshPaimindNativeMcpAssembly, type PaimindMcpAgent, type PaimindMcpAssemblyContext } from '@hansen/harness-compat/native-mcp'
import { FileMcpConnectionRepository } from './repository.js'
import { McpConnectionManager, type McpAgentReferenceSource, type McpRuntimeProjection } from './manager.js'
import { templateSchema } from './contract.js'
import type { McpConnectionRepository, McpOwnerResolver, McpSaveInput, McpIdentityInput, McpToggleInput, McpRemoveInput, McpConnectionView, McpTemplate, McpDraftProbeInput, McpProbeResult } from './contract.js'

export * from './contract.js'
export { McpConnectionManager, type McpRuntimeProjection, type McpAgentReferenceSource } from './manager.js'
export { FileMcpConnectionRepository } from './repository.js'
export const name = 'paimind-mcp-center'
export const inject = ['agents', 'tools']

export interface McpCenterHostContext {
  get(name: string): unknown
  readonly agents: { list(): readonly PaimindMcpAgent[] }
  readonly tools: { guard(callback: (execution: { readonly name: string; readonly agent?: PaimindMcpAgent }) => string | undefined): () => void }
  on(event: 'agent/created' | 'agent/disposed', listener: (payload: { readonly agent: PaimindMcpAgent }) => void): () => void
  on(event: 'agent/pre-step', listener: (payload: { readonly agent: PaimindMcpAgent }, next: () => Promise<unknown>) => Promise<unknown>): () => void
  on(event: 'system-prompt/assemble', listener: (assembly: unknown, context: PaimindMcpAssemblyContext, next: () => Promise<unknown>) => Promise<unknown>, options: { readonly prepend: true }): () => void
  on(event: 'tools/result', listener: (execution: { readonly name: string }, result: { readonly isError: boolean }) => void): () => void
  effect(install: () => void | (() => void | Promise<void>), label?: string): void
}

export interface McpCenterOptions {
  readonly repository?: McpConnectionRepository
  readonly owner?: McpOwnerResolver
  readonly runtime?: McpRuntimeProjection
}

export class PaimindMcpCenterService extends PaimindHostRemoteService {
  readonly manager: McpConnectionManager
  private readonly templateContributions = new Map<string, McpTemplate>()
  constructor(ctx: McpCenterHostContext, options: McpCenterOptions = {}) {
    super(ctx, 'paimindMcpConnections')
    const owner = options.owner ?? { currentOwner: () => `local:${createHash('sha256').update(`${process.getuid?.() ?? 'local'}:${homedir()}`).digest('hex').slice(0, 24)}` }
    this.manager = new McpConnectionManager(options.repository ?? new FileMcpConnectionRepository(dshHomePath('.paimind-mcp-center', 'connections.json')), owner,
      options.runtime ?? {
        mount: mountPaimindNativeMcp, probe: probePaimindNativeMcp,
        preset: agent => resolvePaimindLiveAgentPreset(agent as Parameters<typeof resolvePaimindLiveAgentPreset>[0]),
        credential: async reference => {
          const provider = ctx.get('credentials') as { resolve(reference: string): Promise<{ value: string } | undefined> } | undefined
          const result = await provider?.resolve(reference)
          if (!result?.value) throw new Error('Credential reference is unavailable')
          return result.value
        },
      }, () => {
        const source = ctx.get('paimindAgentProfiles') as Partial<McpAgentReferenceSource> | undefined
        return typeof source?.connectionIdsForPreset === 'function' && typeof source.listProfiles === 'function' ? source as McpAgentReferenceSource : undefined
      })
    markPaimindHostRemoteMethods(this, ['list', 'save', 'probe', 'probeDraft', 'setEnabled', 'removeConnection', 'templates', 'summarizeSession'])
    ctx.effect(() => {
      const starts = (agent: PaimindMcpAgent): void => { void this.manager.reconcile(agent).catch(() => {}) }
      for (const agent of ctx.agents.list()) starts(agent)
      const disposers = [
        ctx.on('agent/created', ({ agent }) => { starts(agent) }),
        ctx.on('agent/disposed', ({ agent }) => { void this.manager.disposeAgent(agent).catch(() => {}) }),
        ctx.on('agent/pre-step', async ({ agent }, next) => { await this.manager.reconcile(agent); return await next() }),
        // Complete native connection discovery even for the first model request.
        ctx.on('system-prompt/assemble', async (assembly, context, next) => {
          if (context.agent) await this.manager.reconcile(context.agent)
          return await refreshPaimindNativeMcpAssembly(ctx, assembly, context, next)
        }, { prepend: true }),
        ctx.tools.guard(execution => this.manager.guard(execution.name, execution.agent)),
        ctx.on('tools/result', (execution, result) => { this.manager.observe(execution.name, !result.isError) }),
      ]
      return async () => {
        // Keep the last-mile guard installed until every native tool has gone.
        try { await this.manager.dispose() } finally { for (const dispose of disposers.reverse()) dispose() }
      }
    }, 'paimind-mcp-center: native MCP lifecycle')
  }
  async list(): Promise<{ items: McpConnectionView[] }> { return await this.manager.list() }
  async summarizeSession(input: { sessionId: string }): ReturnType<McpConnectionManager['summarizeSession']> { return await this.manager.summarizeSession(input) }
  async save(input: McpSaveInput): Promise<McpConnectionView> { return await this.manager.save(input) }
  async probe(input: McpIdentityInput): Promise<McpConnectionView> { return await this.manager.probe(input) }
  async probeDraft(input: McpDraftProbeInput): Promise<McpProbeResult> { return await this.manager.probeDraft(input) }
  async setEnabled(input: McpToggleInput): Promise<McpConnectionView> { return await this.manager.setEnabled(input) }
  async removeConnection(input: McpRemoveInput): Promise<{ removed: true }> { return await this.manager.remove(input) }
  async templates(): Promise<{ items: McpTemplate[] }> { return { items: [...this.templateContributions.values()].map(item => templateSchema.parse(item)) } }
  /** Local plugin contract only, deliberately absent from Remote management methods. */
  registerTemplate(input: McpTemplate): () => void {
    const template = templateSchema.parse(input)
    if (this.templateContributions.has(template.id)) throw new Error('Connection template ID already registered')
    this.templateContributions.set(template.id, template)
    return () => { if (this.templateContributions.get(template.id) === template) this.templateContributions.delete(template.id) }
  }
  /** Source-owned validation is used by Agent Builder before saving new references. */
  async validateSelection(ids: readonly string[]): Promise<void> { await this.manager.validateSelection(ids) }
  /** Product references changed; update existing native scopes before the save returns. */
  async bindingsChanged(): Promise<void> { await this.manager.bindingsChanged() }
}

export async function apply(ctx: McpCenterHostContext): Promise<void> {
  const service = new PaimindMcpCenterService(ctx)
  await service.manager.prepare()
}
