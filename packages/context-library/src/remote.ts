import { inputSchema, resultSchema } from './contract.js'
export const TYPERT_REMOTE = Object.freeze({
  package: '@hansen/context-library',
  descriptors: [
    {
      id: '@hansen/context-library#paimindContextLibrary/request',
      service: 'paimindContextLibrary',
      namespace: 'paimindContextLibrary',
      method: 'request',
      invocation: { kind: 'direct' as const },
      parameters: [
        {
          name: 'input',
          wire: 'input',
          source: 'json' as const,
          codec: {
            mode: 'strict' as const,
            typeSymbol: '@hansen/context-library#ContextInput',
            schema: inputSchema,
          },
        },
      ],
      result: {
        mode: 'strict' as const,
        typeSymbol: '@hansen/context-library#ContextResult',
        schema: resultSchema,
      },
      sourceLocation: {
        file: 'packages/context-library/src/index.ts',
        line: 1,
        column: 1,
      },
    },
  ],
})
export default TYPERT_REMOTE
