import { z } from 'zod'
import { identityInputSchema, removeInputSchema, saveInputSchema, draftProbeInputSchema, probeResultSchema, templateSchema, toggleInputSchema, viewSchema, sessionSummaryInputSchema, connectionSummarySchema } from './contract.js'

function descriptor(method: string, input: z.ZodType | undefined, output: z.ZodType) {
  return Object.freeze({
    id: `@hansen/mcp-center#paimindMcpConnections/${method}`,
    service: 'paimindMcpConnections', namespace: 'paimindMcpConnections', method,
    invocation: Object.freeze({ kind: 'direct' as const }),
    parameters: Object.freeze(input === undefined ? [] : [{ name: 'input', wire: 'input', source: 'json' as const, codec: { mode: 'strict' as const, typeSymbol: `@hansen/mcp-center#${method}Input`, schema: input } }]),
    result: Object.freeze({ mode: 'strict' as const, typeSymbol: `@hansen/mcp-center#${method}Result`, schema: output }),
    sourceLocation: Object.freeze({ file: 'packages/mcp-center/src/index.ts', line: 66, column: 3 }),
  })
}
export const MCP_REMOTE_DESCRIPTORS = Object.freeze([
  descriptor('list', undefined, z.object({ items: z.array(viewSchema) }).strict()),
  descriptor('save', saveInputSchema, viewSchema), descriptor('probe', identityInputSchema, viewSchema),
  descriptor('probeDraft', draftProbeInputSchema, probeResultSchema),
  descriptor('setEnabled', toggleInputSchema, viewSchema), descriptor('removeConnection', removeInputSchema, z.object({ removed: z.literal(true) }).strict()),
  descriptor('templates', undefined, z.object({ items: z.array(templateSchema) }).strict()),
  descriptor('summarizeSession', sessionSummaryInputSchema, z.object({ items: z.array(connectionSummarySchema) }).strict()),
])
export const TYPERT_REMOTE = Object.freeze({ package: '@hansen/mcp-center', descriptors: MCP_REMOTE_DESCRIPTORS })
export default TYPERT_REMOTE
