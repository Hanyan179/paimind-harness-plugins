import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import {
  PaimindHostRemoteService,
  markPaimindHostRemoteMethods,
  definePaimindHarnessTool,
  type PaimindHostToolRegistry,
  type PaimindToolRunContext,
} from '@hansen/harness-compat/host'
import {
  installPaimindContextSkill,
  type PaimindContextSkillHost,
  paimindContextSession,
  requirePaimindContextCaller,
  assertPaimindContextMutation,
} from '@hansen/harness-compat/context-access'
import type { ContextStorage } from './storage.js'
import type { ContextAuthorization } from './authorization.js'
export type { ContextStorage } from './storage.js'
export type { ContextAuthorization } from './authorization.js'
import { ContextLibraryRepository } from './repository.js'
import {
  inputSchema,
  type ContextInput,
  type ContextIdentityProvider,
  type ContextResult,
  type ContextAccessInput,
  type ContextConnectionInput,
  type ContextTarget,
} from './contract.js'
export * from './contract.js'
export const name = 'paimind-context-library'
export const inject = ['agents', 'sessions', 'workspaceRegistry', 'tools']
interface Host extends PaimindContextSkillHost {
  readonly tools: PaimindHostToolRegistry
  effect(
    install: () => void | (() => void | Promise<void>),
    label?: string,
  ): void
}
interface ProfileSource {
  listProfiles(): Promise<{
    profiles: readonly {
      agentId: string
      presetId: string
      name: string
      health: string
    }[]
  }>
}
const TOOL_ACTIONS = [
  'collections',
  'list',
  'read',
  'search',
  'write',
  'mkdir',
  'move',
  'trash',
  'import',
] as const
export interface ContextLibraryOptions {
  readonly root?: string
  readonly identities?: ContextIdentityProvider
  readonly storage?: ContextStorage
  readonly authorization?: ContextAuthorization
}
export class ContextLibraryService extends PaimindHostRemoteService {
  private disposed = false
  readonly repository: ContextLibraryRepository
  private readonly identities: ContextIdentityProvider
  constructor(
    private readonly host: Host,
    options: ContextLibraryOptions = {},
  ) {
    super(host, 'paimindContextLibrary')
    const root = options.root ?? dshHomePath('.paimind-context-library')
    const profiles = (): ProfileSource | undefined =>
      host.get('paimindAgentProfiles') as ProfileSource | undefined
    const owner = () =>
      `local:${createHash('sha256')
        .update(`${process.getuid?.() ?? 'local'}:${homedir()}`)
        .digest('hex')
        .slice(0, 24)}`
    this.identities = options.identities ?? {
      owner,
      validateTarget: async (target) => {
        if (target.kind === 'workspace')
          return host.workspaceRegistry.list().some((w) => w.id === target.id)
        if (target.kind === 'session')
          return (
            host.sessions.get(target.id) !== undefined ||
            host.agents.list().some((a) => a.session.id === target.id)
          )
        return (
          (await profiles()?.listProfiles())?.profiles.some(
            (p) => p.agentId === target.id && p.health === 'healthy',
          ) ?? false
        )
      },
      forSession: async (id) => {
        const scope = paimindContextSession(host, id)
        const targets: ContextTarget[] = [{ kind: 'session', id }]
        if (scope.workspace)
          targets.push({ kind: 'workspace', id: scope.workspace.id })
        const profile = (await profiles()?.listProfiles())?.profiles.find(
          (p) => p.presetId === scope.presetId && p.health === 'healthy',
        )
        if (profile) targets.push({ kind: 'agent', id: profile.agentId })
        return {
          owner: owner(),
          sessionId: id,
          targets,
          ...(scope.workspace ? { workspaceRoot: scope.workspace.path } : {}),
          assertWrite: async () => {
            throw new Error('模型写入必须通过宿主工具执行')
          },
        }
      },
    }
    this.repository = new ContextLibraryRepository(
      root,
      this.identities,
      options.storage,
      options.authorization,
    )
    host.effect(
      () => () => {
        this.disposed = true
      },
      'context-library: lifecycle',
    )
    host.effect(
      () =>
        installPaimindContextSkill(
          host,
          'paimind-context-library',
          async (sessionId) => {
            const effective = await this.repository.resolveSession(sessionId)
            if (!effective.length) return undefined
            return {
              name: 'context-library',
              description:
                '按连接权限访问资料。当前资料夹：' +
                effective
                  .slice(0, 8)
                  .map(
                    (e) =>
                      e.collection.title.replace(/[\r\n\t]/g, ' ') +
                      '（' +
                      (e.mode === 'write' ? '读写' : '只读') +
                      '）',
                  )
                  .join('、')
                  .slice(0, 650),
              content: readFileSync(
                new URL('../skills/context-library/SKILL.md', import.meta.url),
                'utf8',
              ),
            }
          },
        ),
      'context-library: scoped source skill',
    )
    markPaimindHostRemoteMethods(this, ['request'])
    host.effect(
      () =>
        host.tools.register(
          definePaimindHarnessTool({
            name: 'paimind_context',
            description:
              'Browse, search and read explicitly connected Context Library folders. Use write/mkdir/move/trash/import only when the current connection permits writing. Paths are relative to the collection. Read a file before replacing it and pass its revision. import uses toPath as the current Workspace source path. This tool cannot change connections or permissions.',
            parameters: {
              action: { type: 'string', enum: TOOL_ACTIONS, required: true },
              collectionId: { type: 'string' },
              path: {
                type: 'string',
                description:
                  'Collection-relative path. For the collection root, omit path or use an empty string; do not use a dot or slash.',
              },
              toPath: { type: 'string' },
              query: { type: 'string' },
              content: { type: 'string' },
              encoding: { type: 'string', enum: ['utf8', 'base64'] },
              description: { type: 'string' },
              expectedRevision: {
                oneOf: [{ type: 'string' }, { type: 'null' }],
              },
              operationId: { type: 'string' },
              offset: { type: 'integer' },
              limit: { type: 'integer' },
            },
            output: {
              schema: {
                type: 'object',
                additionalProperties: false,
                properties: { result: { type: 'string', required: true } },
              },
              render: (_args, value) => [
                { type: 'text', text: String(value.result) },
              ],
            },
            execute: async (args, exec) => ({
              result: JSON.stringify(
                await this.invoke(inputSchema.parse(args), exec),
              ),
            }),
            isConcurrencySafe: (args) =>
              ['collections', 'list', 'read', 'search'].includes(
                String(args.action),
              ),
          }),
        ),
      'paimind-context-library: native tools',
    )
  }
  async request(input: ContextInput): Promise<ContextResult> {
    if (this.disposed) throw new Error('资料库已停用')
    const parsed = inputSchema.parse(input)
    if (parsed.action === 'targets') {
      const profiles = await (
        this.host.get('paimindAgentProfiles') as ProfileSource | undefined
      )?.listProfiles()
      return {
        targets: [
          ...this.host.workspaceRegistry.list().map((w) => ({
            target: { kind: 'workspace' as const, id: w.id },
            title: w.path,
          })),
          ...(profiles?.profiles ?? [])
            .filter((p) => p.health === 'healthy')
            .map((p) => ({
              target: { kind: 'agent' as const, id: p.agentId },
              title: p.name,
            })),
          ...this.host.agents.list().map((a) => ({
            target: { kind: 'session' as const, id: a.session.id },
            title: `会话 ${a.session.id}`,
          })),
        ],
      }
    }
    if (['mounts', 'setMount', 'removeMount'].includes(parsed.action))
      return this.repository.connections(parsed as ContextConnectionInput)
    if (parsed.action === 'effective')
      return {
        effective: await this.repository.resolveSession(parsed.sessionId ?? ''),
      }
    return this.repository.request(parsed)
  }
  async invoke(
    input: ContextInput,
    exec: PaimindToolRunContext,
  ): Promise<ContextResult> {
    if (this.disposed) throw new Error('资料库已停用')
    if (!TOOL_ACTIONS.includes(input.action as (typeof TOOL_ACTIONS)[number]))
      throw new Error('模型不能管理连接或权限')
    const id = requirePaimindContextCaller(this.host, exec)
    const identity = await this.identities.forSession(id)
    return this.repository.access(
      {
        ...input,
        operationId: input.operationId ?? exec.callId,
      } as ContextAccessInput,
      {
        ...identity,
        callId: exec.callId,
        assertWrite: () => {
          if (this.disposed) throw new Error('资料库已停用')
          requirePaimindContextCaller(this.host, exec)
          return assertPaimindContextMutation(
            this.host,
            exec,
            this.repository.root,
          )
        },
      },
      exec.signal,
    )
  }
}
export function apply(host: Host): void {
  new ContextLibraryService(host)
}
