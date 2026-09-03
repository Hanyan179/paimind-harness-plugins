export const WORKSPACE_BLUEPRINT_CATEGORIES = [
  'all',
  'general',
  'project-delivery',
  'research',
  'data',
  'content',
  'engineering',
] as const

export type WorkspaceBlueprintCategoryFilter = typeof WORKSPACE_BLUEPRINT_CATEGORIES[number]
export type WorkspaceBlueprintCategory = Exclude<WorkspaceBlueprintCategoryFilter, 'all'>
export type WorkspaceBlueprintSource = 'builtin' | 'user'

export const WORKSPACE_BLUEPRINT_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/
export const WORKSPACE_BLUEPRINT_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
export const WORKSPACE_BLUEPRINT_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/

export interface WorkspaceBlueprintAgentBinding {
  readonly agentId: string
  readonly presetId: string
  readonly configVersion: string
}

export interface WorkspaceBlueprintBusinessSkillBinding {
  readonly name: string
  readonly digest: `sha256:${string}`
}

export interface WorkspaceBlueprintComposition {
  readonly agent: Readonly<WorkspaceBlueprintAgentBinding> | null
  readonly businessSkills: readonly Readonly<WorkspaceBlueprintBusinessSkillBinding>[]
}

export type WorkspaceBlueprintCompositionChoiceStatus = 'ready' | 'unavailable' | 'error'

export interface WorkspaceBlueprintAgentChoice extends WorkspaceBlueprintAgentBinding {
  readonly name: string
}

export interface WorkspaceBlueprintBusinessSkillChoice extends WorkspaceBlueprintBusinessSkillBinding {
  readonly description: string
}

export interface WorkspaceBlueprintCompositionChoiceGroup<Item> {
  readonly status: WorkspaceBlueprintCompositionChoiceStatus
  readonly items: readonly Readonly<Item>[]
}

/**
 * One live, source-owned projection for the Blueprint authoring UI. This is a
 * choice list only: Agent Center and Skill Center remain the entity owners.
 */
export interface WorkspaceBlueprintCompositionChoices {
  readonly schema: 'paimind.workspace-blueprint-composition-choices/v1'
  readonly agents: Readonly<WorkspaceBlueprintCompositionChoiceGroup<WorkspaceBlueprintAgentChoice>>
  readonly businessSkills: Readonly<WorkspaceBlueprintCompositionChoiceGroup<WorkspaceBlueprintBusinessSkillChoice>>
}

export interface WorkspaceBlueprintManifest {
  readonly schema: 'paimind.workspace-blueprint/v1'
  readonly blueprintId: string
  readonly version: string
  readonly name: string
  readonly description: string
  readonly category: WorkspaceBlueprintCategory
  readonly tags: readonly string[]
  readonly source: WorkspaceBlueprintSource
  readonly digest: string
  readonly fileCount: number
  readonly totalBytes: number
  readonly createdAt: number
  readonly updatedAt: number
  /** Deterministic composition metadata; materialization never mutates Agent or Skill state. */
  readonly composition: Readonly<WorkspaceBlueprintComposition>
}

export interface WorkspaceBlueprintFileSummary {
  readonly path: string
  readonly kind: 'text' | 'binary'
  readonly size: number
}

export interface WorkspaceBlueprintCatalogItem extends WorkspaceBlueprintManifest {
  readonly versionCount: number
  /** MVP templates are bounded and expose their complete immutable file index. */
  readonly files: readonly Readonly<WorkspaceBlueprintFileSummary>[]
}

export interface WorkspaceBlueprintCatalogPage {
  readonly revision: number
  readonly items: readonly Readonly<WorkspaceBlueprintCatalogItem>[]
  readonly nextCursor?: string
}

export interface WorkspaceBlueprintListInput {
  readonly query?: string
  readonly category?: WorkspaceBlueprintCategoryFilter
  readonly source?: WorkspaceBlueprintSource | 'all'
  readonly cursor?: string
  readonly limit?: number
}

export interface WorkspaceBlueprintIdentityInput {
  readonly blueprintId: string
  readonly version: string
}

export interface WorkspaceBlueprintMaterializeInput extends WorkspaceBlueprintIdentityInput {
  /** Canonical Harness identity. A caller-controlled filesystem path is deliberately absent. */
  readonly workspaceId: string
  readonly expectedDigest: string
}

export interface WorkspaceBlueprintMaterializeResult {
  readonly workspaceId: string
  readonly path: string
  readonly blueprintId: string
  readonly version: string
  readonly digest: string
  readonly warnings: readonly string[]
}

/**
 * Bind only the entry Session created for an already materialized package.
 * The Agent reference is deliberately absent and is recovered from the
 * immutable Workspace receipt on the Host.
 */
export interface WorkspaceBlueprintBindEntryAgentSessionInput extends WorkspaceBlueprintIdentityInput {
  readonly workspaceId: string
  readonly sessionId: string
  readonly expectedDigest: string
}

export interface WorkspaceBlueprintBindEntryAgentSessionResult extends WorkspaceBlueprintIdentityInput {
  readonly workspaceId: string
  readonly sessionId: string
  readonly digest: string
  readonly agent: Readonly<WorkspaceBlueprintAgentBinding>
}

export interface WorkspaceBlueprintPublishInput {
  /** Canonical Harness identity. A caller-controlled source path is deliberately absent. */
  readonly workspaceId: string
  readonly blueprintId: string
  readonly version: string
  readonly name: string
  readonly description: string
  readonly category: WorkspaceBlueprintCategory
  readonly tags?: readonly string[]
  readonly composition: Readonly<WorkspaceBlueprintComposition>
}

export interface WorkspaceBlueprintTreeEntry {
  readonly path: string
  readonly kind: 'directory' | 'text' | 'binary'
  readonly size: number
  readonly digest?: string
}

export interface WorkspaceBlueprintDetail {
  readonly manifest: Readonly<WorkspaceBlueprintManifest>
  readonly entries: readonly Readonly<WorkspaceBlueprintTreeEntry>[]
}

export interface WorkspaceBlueprintReadTextInput extends WorkspaceBlueprintIdentityInput {
  readonly path: string
}

export interface WorkspaceBlueprintTextFile {
  readonly blueprintId: string
  readonly version: string
  readonly blueprintDigest: string
  readonly path: string
  readonly digest: string
  readonly text: string
}

export interface WorkspaceBlueprintMutationInput extends WorkspaceBlueprintIdentityInput {
  readonly expectedDigest: string
  readonly path: string
}

export interface WorkspaceBlueprintUpdateCompositionInput extends WorkspaceBlueprintIdentityInput {
  readonly expectedDigest: string
  readonly composition: Readonly<WorkspaceBlueprintComposition>
}

export interface WorkspaceBlueprintWriteTextInput extends WorkspaceBlueprintMutationInput {
  readonly text: string
}

export interface WorkspaceBlueprintDeleteEntryInput extends WorkspaceBlueprintMutationInput {
  readonly recursive?: boolean
}

export interface WorkspaceBlueprintMutationResult {
  readonly blueprintId: string
  readonly version: string
  readonly digest: string
  readonly fileCount: number
  readonly totalBytes: number
  readonly updatedAt: number
}
