import type { HarnessSkillEntry } from '@paimind/harness-compat'

export const PAIMIND_SKILL_UPLOAD_PATH = '/paimind/skills/uploads'
export const SKILL_MARKET_FILTERS = ['all', 'model', 'user-only', 'favorites'] as const
export type SkillMarketFilter = typeof SKILL_MARKET_FILTERS[number]
export const SKILL_NAME = /^[a-z0-9][a-z0-9-]*$/
export const SKILL_FAVORITES_STORAGE_KEY = 'paimind.skill-market.favorites.v1'

export interface SkillCatalogRow {
  readonly skill: HarnessSkillEntry
  readonly favorite: boolean
  readonly sourceIndex: number
}

export function projectSkillCatalog(
  skills: readonly HarnessSkillEntry[],
  input: { readonly query: string; readonly filter: SkillMarketFilter; readonly favoriteIds: ReadonlySet<string> },
): readonly SkillCatalogRow[] {
  const query = input.query.trim().toLocaleLowerCase()
  return skills.map((skill, sourceIndex): SkillCatalogRow => Object.freeze({
    skill, favorite: input.favoriteIds.has(skill.name), sourceIndex,
  })).filter(row => {
    if (input.filter === 'model' && !row.skill.modelInvocable) return false
    if (input.filter === 'user-only' && row.skill.modelInvocable) return false
    if (input.filter === 'favorites' && !row.favorite) return false
    if (query === '') return true
    return [row.skill.name, row.skill.description, row.skill.whenToUse ?? '']
      .some(value => value.toLocaleLowerCase().includes(query))
  }).sort((left, right) => left.favorite === right.favorite
    ? left.sourceIndex - right.sourceIndex
    : left.favorite ? -1 : 1)
}

export function parseFavoriteSkillNames(value: string | null): readonly string[] {
  if (value === null) return Object.freeze([])
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return Object.freeze([])
    return Object.freeze([...new Set(parsed.filter((name): name is string => typeof name === 'string' && SKILL_NAME.test(name)))])
  } catch { return Object.freeze([]) }
}

export function serializeFavoriteSkillNames(names: readonly string[]): string {
  return JSON.stringify([...new Set(names.filter(name => SKILL_NAME.test(name)))].sort())
}
