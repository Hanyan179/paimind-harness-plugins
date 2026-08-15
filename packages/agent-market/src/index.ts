import type { HarnessAgentPresetEntry } from '@paimind/harness-compat'

/** Client-only feature host companion required by the Harness Loader. */
export const name = 'paimind-agent-market'

/** Agent execution and Preset storage remain entirely Harness-owned. */
export function apply(): void {}

export const AGENT_CENTER_FILTERS = ['all', 'featured', 'favorites', 'system', 'local'] as const
export type AgentCenterFilter = typeof AGENT_CENTER_FILTERS[number]

export type AgentProductCategory = 'general' | 'coding' | 'focused' | 'authoring' | 'custom'

export interface AgentProductMetadata {
  readonly category: AgentProductCategory
  readonly featured: boolean
}

const KEYED_METADATA: Readonly<Record<string, AgentProductMetadata>> = Object.freeze({
  standard: Object.freeze({ category: 'general', featured: true }),
  code: Object.freeze({ category: 'coding', featured: true }),
  minimal: Object.freeze({ category: 'focused', featured: true }),
  cordis: Object.freeze({ category: 'authoring', featured: false }),
})

/** PAIMind product metadata keyed by the one canonical Harness Preset id. */
export function metadataForPreset(preset: HarnessAgentPresetEntry): AgentProductMetadata {
  return KEYED_METADATA[preset.id] ?? Object.freeze({
    category: preset.trust === 'user' ? 'custom' : 'general',
    featured: false,
  })
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
    return [row.preset.id, row.preset.name ?? '', row.preset.description ?? '', row.metadata.category]
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
