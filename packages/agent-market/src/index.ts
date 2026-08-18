import type { HarnessAgentPresetEntry } from '@paimind/harness-compat'

/** Client-only feature host companion required by the Harness Loader. */
export const name = 'paimind-agent-market'

/** Agent execution and Preset storage remain entirely Harness-owned. */
export function apply(): void {}

export const AGENT_CENTER_FILTERS = ['all', 'featured', 'favorites', 'system', 'local'] as const
export type AgentCenterFilter = typeof AGENT_CENTER_FILTERS[number]

export type AgentProductMode = 'standard' | 'ptc' | 'minimal' | 'creator' | 'custom'
export type AgentProductKind = 'platform-mode' | 'business-agent' | 'personal'

export interface AgentBusinessCategoryMetadata {
  readonly id: string
  readonly labelZh: string
  readonly labelEn: string
}

/** Product metadata keyed to a native Preset. Add catalog rows only after the Preset exists in Harness. */
export interface AgentBusinessAgentDefinition {
  readonly presetId: string
  readonly category: AgentBusinessCategoryMetadata
  readonly mode: AgentProductMode
  readonly featured?: boolean
}

/** Official business taxonomy projection. Empty categories never render in the product UI. */
export const AGENT_BUSINESS_AGENT_CATALOG: readonly AgentBusinessAgentDefinition[] = Object.freeze([])

export interface AgentProductMetadata {
  readonly kind: AgentProductKind
  readonly category?: AgentBusinessCategoryMetadata
  readonly mode: AgentProductMode
  readonly featured: boolean
}

const KEYED_METADATA: Readonly<Record<string, AgentProductMetadata>> = Object.freeze({
  standard: Object.freeze({ kind: 'platform-mode', mode: 'standard', featured: true }),
  ptc: Object.freeze({ kind: 'platform-mode', mode: 'ptc', featured: true }),
  code: Object.freeze({ kind: 'platform-mode', mode: 'ptc', featured: true }),
  minimal: Object.freeze({ kind: 'platform-mode', mode: 'minimal', featured: true }),
  cordis: Object.freeze({ kind: 'platform-mode', mode: 'creator', featured: false }),
})

/** PAIMind product metadata keyed by the one canonical Harness Preset id. */
export function metadataForPreset(
  preset: HarnessAgentPresetEntry,
  businessCatalog: readonly AgentBusinessAgentDefinition[] = AGENT_BUSINESS_AGENT_CATALOG,
): AgentProductMetadata {
  const platformMode = KEYED_METADATA[preset.id]
  if (platformMode !== undefined) return platformMode
  if (preset.trust === 'user') return Object.freeze({ kind: 'personal', mode: 'custom', featured: false })
  const business = businessCatalog.find(row => row.presetId === preset.id)
  return Object.freeze({
    kind: 'business-agent',
    category: business?.category ?? Object.freeze({ id: 'uncategorized', labelZh: '未分类', labelEn: 'Uncategorized' }),
    mode: business?.mode ?? 'custom',
    featured: business?.featured ?? false,
  })
}

export interface AgentBusinessCategoryOption extends AgentBusinessCategoryMetadata {
  readonly count: number
}

/** Derive a compact, stable filter list from real native Presets instead of rendering a fixed category row. */
export function collectBusinessAgentCategories(
  presets: readonly HarnessAgentPresetEntry[],
  businessCatalog: readonly AgentBusinessAgentDefinition[] = AGENT_BUSINESS_AGENT_CATALOG,
): readonly AgentBusinessCategoryOption[] {
  const categories = new Map<string, AgentBusinessCategoryOption>()
  for (const preset of presets) {
    const metadata = metadataForPreset(preset, businessCatalog)
    if (preset.trust !== 'system' || metadata.kind !== 'business-agent' || metadata.category === undefined) continue
    const current = categories.get(metadata.category.id)
    categories.set(metadata.category.id, Object.freeze({ ...metadata.category, count: (current?.count ?? 0) + 1 }))
  }
  return Object.freeze([...categories.values()].sort((left, right) => left.labelZh.localeCompare(right.labelZh)))
}

export interface AgentCatalogRow {
  /** Exact native object; PAIMind never copies or rewrites its runtime fields. */
  readonly preset: HarnessAgentPresetEntry
  readonly metadata: AgentProductMetadata
  readonly favorite: boolean
  readonly sourceIndex: number
}

export interface AgentCatalogQuery {
  readonly query: string
  readonly filter: AgentCenterFilter
  readonly favoriteIds: ReadonlySet<string>
}

/** Join native roster facts with keyed product metadata without inventing Presets. */
export function projectAgentCatalog(
  presets: readonly HarnessAgentPresetEntry[],
  input: AgentCatalogQuery,
): readonly AgentCatalogRow[] {
  const query = input.query.trim().toLocaleLowerCase()
  return presets.map((preset, sourceIndex): AgentCatalogRow => {
    const metadata = metadataForPreset(preset)
    return Object.freeze({ preset, metadata, favorite: input.favoriteIds.has(preset.id), sourceIndex })
  }).filter(row => {
    if (input.filter === 'featured' && !row.metadata.featured) return false
    if (input.filter === 'favorites' && !row.favorite) return false
    if (input.filter === 'system' && row.preset.trust !== 'system') return false
    if (input.filter === 'local' && row.preset.trust !== 'user') return false
    if (query.length === 0) return true
    return [
      row.preset.id,
      row.preset.name ?? '',
      row.preset.description ?? '',
      row.metadata.category?.id ?? '',
      row.metadata.category?.labelZh ?? '',
      row.metadata.category?.labelEn ?? '',
      row.metadata.mode,
    ]
      .some(value => value.toLocaleLowerCase().includes(query))
  }).sort((left, right) => {
    if (left.favorite !== right.favorite) return left.favorite ? -1 : 1
    if (left.metadata.featured !== right.metadata.featured) return left.metadata.featured ? -1 : 1
    return left.sourceIndex - right.sourceIndex
  })
}

export const AGENT_FAVORITES_STORAGE_KEY = 'paimind.agent-center.favorites.v1'

/** Parse only Preset ids; malformed metadata cannot affect the native roster. */
export function parseFavoritePresetIds(value: string | null): readonly string[] {
  if (value === null) return Object.freeze([])
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return Object.freeze([])
    return Object.freeze([...new Set(parsed.filter((id): id is string => (
      typeof id === 'string' && /^[a-z0-9][a-z0-9._-]*$/i.test(id)
    )))])
  } catch {
    return Object.freeze([])
  }
}

export function serializeFavoritePresetIds(ids: readonly string[]): string {
  return JSON.stringify([...new Set(ids)].sort())
}
