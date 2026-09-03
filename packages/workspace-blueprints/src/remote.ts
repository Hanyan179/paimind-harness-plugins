import { z } from 'zod'

const blueprintId = z.string().regex(/^[a-z0-9][a-z0-9-]*$/).max(100)
const version = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/).max(100)
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const category = z.enum(['general', 'project-delivery', 'research', 'data', 'content', 'engineering'])
const source = z.enum(['builtin', 'user'])
const agentBinding = z.object({
  agentId: z.string().min(1).max(200),
  presetId: z.string().min(1).max(200),
  configVersion: z.string().min(1).max(200),
}).strict().readonly()
const businessSkillBinding = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).max(100),
  digest,
}).strict().readonly()
const composition = z.object({
  agent: agentBinding.nullable(),
  businessSkills: z.array(businessSkillBinding).max(100).readonly(),
}).strict().readonly()
const choiceStatus = z.enum(['ready', 'unavailable', 'error'])
const agentChoice = z.object({
  agentId: z.string().min(1).max(200),
  presetId: z.string().min(1).max(200),
  configVersion: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
}).strict().readonly()
const businessSkillChoice = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).max(100),
  description: z.string().max(2_000),
  digest,
}).strict().readonly()
const compositionChoices = z.object({
  schema: z.literal('paimind.workspace-blueprint-composition-choices/v1'),
  agents: z.object({ status: choiceStatus, items: z.array(agentChoice).readonly() }).strict().readonly(),
  businessSkills: z.object({ status: choiceStatus, items: z.array(businessSkillChoice).readonly() }).strict().readonly(),
}).strict().readonly()
const manifestObject = z.object({
  schema: z.literal('paimind.workspace-blueprint/v1'),
  blueprintId,
  version,
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(2_000),
  category,
  tags: z.array(z.string().min(1).max(100)).max(20).readonly(),
  source,
  digest,
  fileCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  composition,
}).strict()
const manifest = manifestObject.readonly()
const fileSummary = z.object({
  path: z.string().min(1).max(500),
  kind: z.enum(['text', 'binary']),
  size: z.number().int().nonnegative(),
}).strict().readonly()
const catalogItem = manifestObject.extend({
  versionCount: z.number().int().positive(),
  files: z.array(fileSummary).max(5_000).readonly(),
}).strict().readonly()
const catalogPage = z.object({
  revision: z.number().int().nonnegative(),
  items: z.array(catalogItem).max(200).readonly(),
  nextCursor: z.string().regex(/^\d+$/).optional(),
}).strict().readonly()
const listInput = z.object({
  query: z.string().max(200).optional(),
  category: z.enum(['all', 'general', 'project-delivery', 'research', 'data', 'content', 'engineering']).optional(),
  source: z.enum(['all', 'builtin', 'user']).optional(),
  cursor: z.string().regex(/^\d+$/).optional(),
  limit: z.number().int().min(1).max(200).optional(),
}).strict().readonly()
const identityInputObject = z.object({ blueprintId, version }).strict()
const identityInput = identityInputObject.readonly()
const materializeInput = identityInputObject.extend({
  workspaceId: z.string().min(1).max(200),
  expectedDigest: digest,
}).strict().readonly()
const materializeResult = z.object({
  workspaceId: z.string().min(1).max(200),
  path: z.string().min(1),
  blueprintId,
  version,
  digest,
  warnings: z.array(z.string()).readonly(),
}).strict().readonly()
const bindEntryAgentSessionInput = identityInputObject.extend({
  workspaceId: z.string().min(1).max(200),
  sessionId: z.string().min(1).max(200),
  expectedDigest: digest,
}).strict().readonly()
const bindEntryAgentSessionResult = z.object({
  workspaceId: z.string().min(1).max(200),
  sessionId: z.string().min(1).max(200),
  blueprintId,
  version,
  digest,
  agent: agentBinding,
}).strict().readonly()
const publishInput = z.object({
  workspaceId: z.string().min(1).max(200),
  blueprintId,
  version,
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(2_000),
  category,
  tags: z.array(z.string().min(1).max(100)).max(20).readonly().optional(),
  composition,
}).strict().readonly()
const treeEntry = z.object({
  path: z.string().min(1).max(500),
  kind: z.enum(['directory', 'text', 'binary']),
  size: z.number().int().nonnegative(),
  digest: digest.optional(),
}).strict().readonly()
const detail = z.object({
  manifest,
  entries: z.array(treeEntry).max(10_000).readonly(),
}).strict().readonly()
const readTextInput = identityInputObject.extend({ path: z.string().min(1).max(500) }).strict().readonly()
const textFile = z.object({
  blueprintId,
  version,
  blueprintDigest: digest,
  path: z.string().min(1).max(500),
  digest,
  text: z.string(),
}).strict().readonly()
const mutationInputObject = identityInputObject.extend({
  expectedDigest: digest,
  path: z.string().min(1).max(500),
}).strict()
const mutationInput = mutationInputObject.readonly()
const writeTextInput = mutationInputObject.extend({ text: z.string() }).strict().readonly()
const deleteEntryInput = mutationInputObject.extend({ recursive: z.boolean().optional() }).strict().readonly()
const updateCompositionInput = identityInputObject.extend({
  expectedDigest: digest,
  composition,
}).strict().readonly()
const mutationResult = z.object({
  blueprintId,
  version,
  digest,
  fileCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}).strict().readonly()

export const PAIMIND_WORKSPACE_BLUEPRINT_REMOTE_DESCRIPTORS = Object.freeze([
  descriptor('listBlueprints', 'WorkspaceBlueprintListInput', listInput, 'WorkspaceBlueprintCatalogPage', catalogPage, 72),
  noInputDescriptor('getCompositionChoices', 'WorkspaceBlueprintCompositionChoices', compositionChoices, 76),
  descriptor('materializeBlueprint', 'WorkspaceBlueprintMaterializeInput', materializeInput, 'WorkspaceBlueprintMaterializeResult', materializeResult, 76),
  descriptor('bindEntryAgentSession', 'WorkspaceBlueprintBindEntryAgentSessionInput', bindEntryAgentSessionInput, 'WorkspaceBlueprintBindEntryAgentSessionResult', bindEntryAgentSessionResult, 80),
  descriptor('publishBlueprint', 'WorkspaceBlueprintPublishInput', publishInput, 'WorkspaceBlueprintManifest', manifest, 82),
  descriptor('getBlueprint', 'WorkspaceBlueprintIdentityInput', identityInput, 'WorkspaceBlueprintDetail', detail, 86),
  descriptor('readBlueprintText', 'WorkspaceBlueprintReadTextInput', readTextInput, 'WorkspaceBlueprintTextFile', textFile, 90),
  descriptor('writeBlueprintText', 'WorkspaceBlueprintWriteTextInput', writeTextInput, 'WorkspaceBlueprintMutationResult', mutationResult, 94),
  descriptor('createBlueprintDirectory', 'WorkspaceBlueprintMutationInput', mutationInput, 'WorkspaceBlueprintMutationResult', mutationResult, 98),
  descriptor('deleteBlueprintFile', 'WorkspaceBlueprintDeleteEntryInput', deleteEntryInput, 'WorkspaceBlueprintMutationResult', mutationResult, 104),
  descriptor('updateBlueprintComposition', 'WorkspaceBlueprintUpdateCompositionInput', updateCompositionInput, 'WorkspaceBlueprintMutationResult', mutationResult, 110),
])

function noInputDescriptor(
  method: string,
  resultType: string,
  resultSchema: z.ZodType,
  line: number,
) {
  return Object.freeze({
    id: `@paimind/workspace-blueprints#paimindWorkspaceBlueprints/${method}`,
    service: 'paimindWorkspaceBlueprints',
    namespace: 'paimindWorkspaceBlueprints',
    method,
    invocation: Object.freeze({ kind: 'direct' as const }),
    parameters: Object.freeze([]),
    result: Object.freeze({
      mode: 'strict' as const,
      typeSymbol: `@paimind/workspace-blueprints#${resultType}`,
      schema: resultSchema,
    }),
    sourceLocation: Object.freeze({ file: 'packages/workspace-blueprints/src/index.ts', line, column: 3 }),
  })
}

function descriptor(
  method: string,
  inputType: string,
  inputSchema: z.ZodType,
  resultType: string,
  resultSchema: z.ZodType,
  line: number,
) {
  return Object.freeze({
    id: `@paimind/workspace-blueprints#paimindWorkspaceBlueprints/${method}`,
    service: 'paimindWorkspaceBlueprints',
    namespace: 'paimindWorkspaceBlueprints',
    method,
    invocation: Object.freeze({ kind: 'direct' as const }),
    parameters: Object.freeze([Object.freeze({
      name: 'input',
      wire: 'input',
      source: 'json' as const,
      codec: Object.freeze({
        mode: 'strict' as const,
        typeSymbol: `@paimind/workspace-blueprints#${inputType}`,
        schema: inputSchema,
      }),
    })]),
    result: Object.freeze({
      mode: 'strict' as const,
      typeSymbol: `@paimind/workspace-blueprints#${resultType}`,
      schema: resultSchema,
    }),
    sourceLocation: Object.freeze({ file: 'packages/workspace-blueprints/src/index.ts', line, column: 3 }),
  })
}

export const TYPERT_REMOTE = Object.freeze({
  package: '@paimind/workspace-blueprints',
  descriptors: PAIMIND_WORKSPACE_BLUEPRINT_REMOTE_DESCRIPTORS,
})

export default TYPERT_REMOTE
