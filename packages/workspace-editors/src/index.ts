import { readFileSync } from 'node:fs'
import {
  PaimindHostRemoteService,
  markPaimindHostRemoteMethods,
  definePaimindHarnessTool,
  type PaimindHostToolRegistry,
} from '@hansen/harness-compat/host'
import {
  installPaimindContextSkill,
  type PaimindContextSkillHost,
  paimindContextSession,
  assertPaimindContextMutation,
  requirePaimindContextCaller,
} from '@hansen/harness-compat/context-access'
import {
  editorInputSchema,
  type EditorInput,
  type EditorResult,
} from './contract.js'
import { WorkspaceEditorFiles } from './service.js'
export * from './contract.js'
export const name = 'paimind-workspace-editors'
export const inject = ['workspaceRegistry', 'agents', 'sessions', 'tools']
interface Host extends PaimindContextSkillHost {
  readonly tools: PaimindHostToolRegistry
  effect(install: () => void | (() => void), label?: string): void
}
export class WorkspaceEditorsService extends PaimindHostRemoteService {
  readonly files: WorkspaceEditorFiles
  constructor(host: Host) {
    super(host, 'paimindWorkspaceEditors')
    this.files = new WorkspaceEditorFiles(host.workspaceRegistry)
    host.effect(
      () =>
        installPaimindContextSkill(
          host,
          'paimind-workspace-editing',
          async (sessionId) => {
            if (!paimindContextSession(host, sessionId).workspace)
              return undefined
            return {
              name: 'workspace-editing',
              description:
                '读取并编辑当前工作区的文档、幻灯片和表格，按文件版本保存。',
              content: readFileSync(
                new URL(
                  '../skills/workspace-editing/SKILL.md',
                  import.meta.url,
                ),
                'utf8',
              ),
            }
          },
        ),
      'workspace-editors: scoped source skill',
    )
    markPaimindHostRemoteMethods(this, ['call', 'list'])
    host.effect(
      () => () => this.files.dispose(),
      'paimind-workspace-editors: model lifecycle',
    )
    host.effect(
      () =>
        host.tools.register(
          definePaimindHarnessTool({
            name: 'paimind_workspace_document',
            description:
              'Read and edit the canonical document, slide deck or workbook in the current Workspace. First call getDocument (docs/sheets) or getDeck (slides) to obtain the structure and revision. Then call format-specific methods with args, expectedRevision and operationId. Docs: applyOperation or setDocument; slides: addSlide/updateBlock/setDeck etc.; sheets: applyOperation. Workspace README describes arguments. Never overwrite a file without reading its current revision.',
            parameters: {
              path: { type: 'string', required: true },
              method: { type: 'string', required: true },
              args: { type: 'array', items: { type: 'json' }, required: true },
              expectedRevision: { type: 'string' },
              operationId: { type: 'string' },
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
            execute: async (args, exec) => {
              const scope = paimindContextSession(
                host,
                requirePaimindContextCaller(host, exec),
              )
              if (!scope.workspace) throw new Error('当前会话未绑定工作区')
              const input = editorInputSchema.parse({
                ...args,
                workspaceId: scope.workspace.id,
                operationId: args.operationId ?? exec.callId,
              })
              return {
                result: JSON.stringify(
                  await this.files.call(
                    input,
                    () => {
                      const latest = paimindContextSession(
                        host,
                        requirePaimindContextCaller(host, exec),
                      )
                      if (
                        latest.workspace?.id !== scope.workspace?.id ||
                        latest.workspace?.path !== scope.workspace?.path
                      )
                        throw new Error('工作区归属已变化')
                      return assertPaimindContextMutation(
                        host,
                        exec,
                        scope.workspace!.path,
                      )
                    },
                    exec.signal,
                  ),
                ),
              }
            },
            isConcurrencySafe: (args) => String(args.method).startsWith('get'),
          }),
        ),
      'paimind-workspace-editors: native tool',
    )
  }
  async list(input: { workspaceId: string }) {
    return this.files.list(input.workspaceId)
  }
  async call(input: EditorInput): Promise<EditorResult> {
    return this.files.call(input)
  }
}
export function apply(host: Host): void {
  new WorkspaceEditorsService(host)
}
