import { describe, expect, it } from 'vitest'
import type { HarnessSkillEntry } from '@hansen/harness-compat'
import { metadataForSkill, projectSkillCatalog } from '../src/index.js'

describe('FP11 native Skill catalog projection', () => {
  it('gives legacy catalog items a deterministic category and stable general fallback', () => {
    expect(metadataForSkill({ name: 'openai-docs' })).toEqual({ category: 'research', tags: ['official-docs', 'research'] })
    expect(metadataForSkill({ name: 'spreadsheet-inspector', description: 'Analyze Excel data' }).category).toBe('data')
    expect(metadataForSkill({ name: 'unknown-capability', description: 'A specialized capability' }).category).toBe('general')
  })

  it('prefers supplied product metadata and normalizes its tags before heuristic classification', () => {
    expect(metadataForSkill({
      name: 'release-helper', description: 'Search and analyze release data', category: 'engineering',
      tags: [' Release-Pipeline ', 'release-pipeline', '', 42],
    })).toEqual({ category: 'engineering', tags: ['release-pipeline'] })
    expect(metadataForSkill({ name: 'unknown-capability', tags: ['Spreadsheet'] })).toEqual({ category: 'data', tags: ['spreadsheet'] })
  })

  it('adds category metadata while retaining the exact native Harness Skill object', () => {
    const skill: HarnessSkillEntry = Object.freeze({
      name: 'spreadsheet-inspector', description: 'Analyze Excel data', whenToUse: 'Use for a workbook.', modelInvocable: true,
    })
    const rows = projectSkillCatalog([skill], { query: 'spreadsheet', category: 'data' })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.skill).toBe(skill)
    expect(rows[0]?.metadata.category).toBe('data')
    expect(rows[0]).not.toHaveProperty('favorite')
  })
})
