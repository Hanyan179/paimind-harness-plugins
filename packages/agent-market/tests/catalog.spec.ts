import { describe, expect, it } from 'vitest'
import {
  collectBusinessAgentCategories,
  metadataForPreset,
  parseFavoritePresetIds,
  projectAgentCatalog,
  serializeFavoritePresetIds,
} from '../src/index.js'

const presets = [
  { id: 'standard', trust: 'system', isDefault: true, name: 'Standard', description: 'General agent' },
  { id: 'minimal', trust: 'system', isDefault: false, name: 'Minimal', description: 'Focused agent' },
  { id: 'mine', trust: 'user', isDefault: false, name: 'Mine', description: 'Local agent' },
] as const

describe('FP09 native Agent Preset catalog projection', () => {
  it('keeps exact native objects and joins only metadata keyed by Preset id', () => {
    const rows = projectAgentCatalog(presets, { query: '', filter: 'all', favoriteIds: new Set(['mine', 'ghost']) })
    expect(rows.map(row => row.preset)).toEqual([presets[2], presets[0], presets[1]])
    expect(rows[0]?.preset).toBe(presets[2])
    expect(rows.some(row => row.preset.id === 'ghost')).toBe(false)
    expect(metadataForPreset(presets[0])).toEqual({ kind: 'platform-mode', mode: 'standard', featured: true })
    expect(metadataForPreset(presets[1])).toEqual({ kind: 'platform-mode', mode: 'minimal', featured: true })
    expect(metadataForPreset(presets[2])).toEqual({ kind: 'personal', mode: 'custom', featured: false })
  })

  it('derives a compact business-category catalog from any number of real Presets', () => {
    const businessPresets = Array.from({ length: 48 }, (_, index) => ({
      id: `business-${index}`, trust: 'system' as const, isDefault: false, name: `Business ${index}`,
    }))
    const catalog = businessPresets.map((preset, index) => ({
      presetId: preset.id,
      category: { id: `category-${index}`, labelZh: `业务 ${index}`, labelEn: `Business ${index}` },
      mode: 'standard' as const,
    }))
    const categories = collectBusinessAgentCategories(businessPresets, catalog)
    expect(categories).toHaveLength(48)
    expect(new Set(categories.map(row => row.id)).size).toBe(48)
    expect(categories.every(row => row.count === 1)).toBe(true)
    expect(metadataForPreset(businessPresets[0]!, catalog)).toEqual({
      kind: 'business-agent', category: catalog[0]!.category, mode: 'standard', featured: false,
    })
  })

  it('searches native facts and applies featured/system/local/favorite filters deterministically', () => {
    expect(projectAgentCatalog(presets, { query: 'focused', filter: 'all', favoriteIds: new Set() }).map(row => row.preset.id)).toEqual(['minimal'])
    expect(projectAgentCatalog(presets, { query: '', filter: 'featured', favoriteIds: new Set() }).map(row => row.preset.id)).toEqual(['standard', 'minimal'])
    expect(projectAgentCatalog(presets, { query: '', filter: 'local', favoriteIds: new Set() }).map(row => row.preset.id)).toEqual(['mine'])
    expect(projectAgentCatalog(presets, { query: '', filter: 'favorites', favoriteIds: new Set(['minimal']) }).map(row => row.preset.id)).toEqual(['minimal'])
  })

  it('fails closed on malformed favorite metadata and serializes stable unique ids', () => {
    expect(parseFavoritePresetIds('{')).toEqual([])
    expect(parseFavoritePresetIds('["standard",42,"../../bad","standard"]')).toEqual(['standard'])
    expect(serializeFavoritePresetIds(['mine', 'standard', 'mine'])).toBe('["mine","standard"]')
  })
})
