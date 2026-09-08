import {
  editorInputSchema,
  editorResultSchema,
  editorListInputSchema,
  editorListSchema,
} from './contract.js'
export const TYPERT_REMOTE = Object.freeze({
  package: '@hansen/workspace-editors',
  descriptors: [
    {
      id: '@hansen/workspace-editors#paimindWorkspaceEditors/call',
      service: 'paimindWorkspaceEditors',
      namespace: 'paimindWorkspaceEditors',
      method: 'call',
      invocation: { kind: 'direct' as const },
      parameters: [
        {
          name: 'input',
          wire: 'input',
          source: 'json' as const,
          codec: {
            mode: 'strict' as const,
            typeSymbol: '@hansen/workspace-editors#EditorInput',
            schema: editorInputSchema,
          },
        },
      ],
      result: {
        mode: 'strict' as const,
        typeSymbol: '@hansen/workspace-editors#EditorResult',
        schema: editorResultSchema,
      },
      sourceLocation: {
        file: 'packages/workspace-editors/src/index.ts',
        line: 1,
        column: 1,
      },
    },
    {
      id: '@hansen/workspace-editors#paimindWorkspaceEditors/list',
      service: 'paimindWorkspaceEditors',
      namespace: 'paimindWorkspaceEditors',
      method: 'list',
      invocation: { kind: 'direct' as const },
      parameters: [
        {
          name: 'input',
          wire: 'input',
          source: 'json' as const,
          codec: {
            mode: 'strict' as const,
            typeSymbol: '@hansen/workspace-editors#EditorListInput',
            schema: editorListInputSchema,
          },
        },
      ],
      result: {
        mode: 'strict' as const,
        typeSymbol: '@hansen/workspace-editors#EditorDocumentList',
        schema: editorListSchema,
      },
      sourceLocation: {
        file: 'packages/workspace-editors/src/index.ts',
        line: 1,
        column: 1,
      },
    },
  ],
})
export default TYPERT_REMOTE
