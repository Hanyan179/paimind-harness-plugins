import { z } from 'zod'

export const connectionId = z.string().regex(/^[a-f0-9]{32}$/)
const referenceMap = z.record(z.string().min(1).max(100), z.string().regex(/^[A-Z_][A-Z0-9_]*$/)).default({})
const common = {
  id: connectionId,
  name: z.string().trim().min(1).max(100),
  category: z.enum(['documents', 'development', 'data', 'other']),
  enabled: z.boolean(),
  timeoutMs: z.number().int().min(1000).max(120_000).default(60_000),
}
const transport = z.discriminatedUnion('transport', [
  z.object({ ...common, transport: z.literal('stdio'), command: z.string().min(1).max(4096), args: z.array(z.string().max(8192)).max(100), cwd: z.string().min(1).max(4096), envRefs: referenceMap }).strict(),
  z.object({ ...common, transport: z.literal('streamable-http'), url: z.url().refine(value => { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && url.username === '' && url.password === '' && url.hash === '' }, 'Use an HTTP(S) endpoint without embedded credentials'), headerRefs: referenceMap }).extend({ timeoutMs: common.timeoutMs }).strict(),
])
export const connectionSchema = z.object({ configuration: transport, owner: z.string(), revision: z.number().int().positive(), updatedAt: z.number() }).strict()
export const toolSummarySchema = z.object({ name: z.string(), description: z.string() }).strict()
export const evidenceSchema = z.object({ at: z.number(), status: z.enum(['passed', 'failed', 'unknown']), message: z.string() }).strict()
export const viewSchema = z.object({
  connection: connectionSchema, tools: z.array(toolSummarySchema),
  state: z.enum(['disabled', 'untested', 'available', 'error']),
  probe: evidenceSchema.nullable(), business: evidenceSchema.nullable(),
  bindings: z.array(z.object({ presetId: z.string(), name: z.string() }).strict()),
}).strict()
export const saveInputSchema = z.object({ configuration: transport, expectedRevision: z.number().int().nonnegative() }).strict()
export const draftProbeInputSchema = z.object({ configuration: transport }).strict()
export const probeResultSchema = z.object({ tools: z.array(toolSummarySchema), evidence: evidenceSchema }).strict()
export const identityInputSchema = z.object({ id: connectionId, expectedRevision: z.number().int().positive() }).strict()
export const toggleInputSchema = identityInputSchema.extend({ enabled: z.boolean() }).strict()
export const removeInputSchema = identityInputSchema.extend({ acknowledgeBindings: z.boolean().default(false) }).strict()
export const templateSchema = z.object({
  id: z.string().min(1).max(100), name: z.string().min(1).max(100),
  description: z.string().max(500), setupHint: z.string().max(2000).optional(),
  locales: z.object({ en: z.object({ name: z.string().max(100), description: z.string().max(500), setupHint: z.string().max(2000).optional() }).strict().optional() }).strict().optional(),
  configuration: z.discriminatedUnion('transport', [transport.options[0].omit({ id: true, name: true }), transport.options[1].omit({ id: true, name: true })]),
}).strict()
export type McpConfiguration = z.infer<typeof transport>
export type McpConnection = z.infer<typeof connectionSchema>
export type McpConnectionView = z.infer<typeof viewSchema>
export type McpEvidence = z.infer<typeof evidenceSchema>
export type McpSaveInput = z.infer<typeof saveInputSchema>
export type McpDraftProbeInput = z.infer<typeof draftProbeInputSchema>
export type McpProbeResult = z.infer<typeof probeResultSchema>
export type McpIdentityInput = z.infer<typeof identityInputSchema>
export type McpToggleInput = z.infer<typeof toggleInputSchema>
export type McpRemoveInput = z.infer<typeof removeInputSchema>
export type McpTemplate = z.infer<typeof templateSchema>

/** Source-owned, lifecycle-bound UI defaults; never a tool or connection registry. */
export interface McpTemplateContribution {
  registerTemplate(template: McpTemplate): () => void
}

/** Management only: tool invocation remains on the native Harness conversation pipeline. */
export interface McpManagement {
  list(): Promise<{ items: McpConnectionView[] }>
  save(input: McpSaveInput): Promise<McpConnectionView>
  probe(input: McpIdentityInput): Promise<McpConnectionView>
  probeDraft(input: McpDraftProbeInput): Promise<McpProbeResult>
  setEnabled(input: McpToggleInput): Promise<McpConnectionView>
  removeConnection(input: McpRemoveInput): Promise<{ removed: true }>
  templates(): Promise<{ items: McpTemplate[] }>
}

export const sessionSummaryInputSchema = z.object({ sessionId: z.string().min(1).max(200) }).strict()
export const connectionSummarySchema = z.object({
  id: connectionId, name: z.string(), server: z.string(), enabled: z.boolean(), mounted: z.boolean(),
}).strict()
export type McpConnectionSummary = z.infer<typeof connectionSummarySchema>
/** Read-only display metadata. It neither opens a connection nor invokes a tool. */
export interface McpSummaryReader {
  summarizeSession(input: z.infer<typeof sessionSummaryInputSchema>): Promise<{ items: McpConnectionSummary[] }>
}

export interface McpConnectionRepository {
  load(owner: string): Promise<McpConnection[]>
  replace(owner: string, connections: readonly McpConnection[]): Promise<void>
}

export interface McpOwnerResolver { currentOwner(): string }
