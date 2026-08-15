import { describe, expect, it } from 'vitest'
import { parseFavoriteSkillNames, projectSkillCatalog, serializeFavoriteSkillNames } from '../src/index.js'

const skills = [
  { name: 'slide-builder', description: 'Build slides', whenToUse: 'Presentations', modelInvocable: true },
  { name: 'private-review', description: 'Review private input', modelInvocable: false },
] as const

describe('FP11 native Skill catalog projection', () => {
  it('retains exact native rows and filters without inventing Skill objects', () => {
    const rows = projectSkillCatalog(skills, { query: 'present', filter: 'all', favoriteIds: new Set(['slide-builder', 'ghost']) })
    expect(rows).toHaveLength(1); expect(rows[0]?.skill).toBe(skills[0]); expect(rows[0]?.favorite).toBe(true)
    expect(projectSkillCatalog(skills, { query: '', filter: 'user-only', favoriteIds: new Set() }).map(row => row.skill.name)).toEqual(['private-review'])
    expect(projectSkillCatalog(skills, { query: '', filter: 'model', favoriteIds: new Set() }).map(row => row.skill.name)).toEqual(['slide-builder'])
  })

  it('keeps only valid native Skill names in browser metadata', () => {
    expect(parseFavoriteSkillNames('["slide-builder","../bad",42,"slide-builder"]')).toEqual(['slide-builder'])
    expect(serializeFavoriteSkillNames(['slide-builder', 'private-review', 'slide-builder'])).toBe('["private-review","slide-builder"]')
  })
})
