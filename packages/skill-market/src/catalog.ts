import type { HarnessSkillEntry } from '@paimind/harness-compat'

export const PAIMIND_SKILL_UPLOAD_PATH = '/paimind/skills/uploads'
export const SKILL_MARKET_FILTERS = ['all', 'model', 'user-only', 'favorites'] as const
export type SkillMarketFilter = typeof SKILL_MARKET_FILTERS[number]
export const SKILL_NAME = /^[a-z0-9][a-z0-9-]*$/
export const SKILL_FAVORITES_STORAGE_KEY = 'paimind.skill-market.favorites.v1'
export const SKILL_PRODUCT_CATEGORIES = ['all', 'general', 'research', 'data', 'content', 'product', 'engineering', 'agent-tools'] as const
export type SkillProductCategoryFilter = typeof SKILL_PRODUCT_CATEGORIES[number]
export type SkillProductCategory = Exclude<SkillProductCategoryFilter, 'all'>

export interface SkillProductMetadata {
  readonly category: SkillProductCategory
  readonly tags: readonly string[]
}

const KNOWN_SKILL_METADATA: Readonly<Record<string, SkillProductMetadata>> = Object.freeze({
  'openai-docs': Object.freeze({ category: 'research', tags: Object.freeze(['official-docs', 'research']) }),
  'skill-creator': Object.freeze({ category: 'agent-tools', tags: Object.freeze(['agent-authoring', 'skill-governance']) }),
  'skill-installer': Object.freeze({ category: 'agent-tools', tags: Object.freeze(['installation', 'skill-governance']) }),
  'bento-ppt': Object.freeze({ category: 'content', tags: Object.freeze(['presentation', 'artifact']) }),
  'ppt-master': Object.freeze({ category: 'content', tags: Object.freeze(['presentation', 'artifact']) }),
  'fineline-investment-analysis': Object.freeze({ category: 'product', tags: Object.freeze(['pdm', 'data-analysis']) }),
  'white-space-analysis': Object.freeze({ category: 'product', tags: Object.freeze(['pdm', 'data-analysis']) }),
  'build-walmart-buyer-proposal-outline': Object.freeze({ category: 'product', tags: Object.freeze(['pdm', 'proposal']) }),
})

/** Product-only taxonomy projection. Native Harness Skill entries remain the runtime source of truth. */
export function metadataForSkill(input: {
  readonly name: string
  readonly description?: string
  readonly whenToUse?: string
}): Readonly<SkillProductMetadata> {
  const known = KNOWN_SKILL_METADATA[input.name]
  if (known !== undefined) return known
  const searchable = `${input.name} ${input.description ?? ''} ${input.whenToUse ?? ''}`.toLocaleLowerCase()
  if (/\b(research|search|docs?|citation|source|browser|web)\b/.test(searchable)) {
    return Object.freeze({ category: 'research', tags: Object.freeze(['research']) })
  }
  if (/\b(data|analysis|analytics|spreadsheet|excel|sql|chart)\b/.test(searchable)) {
    return Object.freeze({ category: 'data', tags: Object.freeze(['data']) })
  }
  if (/\b(ppt|slides?|presentation|document|pdf|content|report|writing)\b/.test(searchable)) {
    return Object.freeze({ category: 'content', tags: Object.freeze(['content']) })
  }
  if (/\b(product|pdm|proposal|buyer|market|merchandising)\b/.test(searchable)) {
    return Object.freeze({ category: 'product', tags: Object.freeze(['product']) })
  }
  if (/\b(code|coding|developer|engineering|git|test|debug|deploy)\b/.test(searchable)) {
    return Object.freeze({ category: 'engineering', tags: Object.freeze(['engineering']) })
  }
  if (/\b(agent|skill|prompt|workflow|tool)\b/.test(searchable)) {
    return Object.freeze({ category: 'agent-tools', tags: Object.freeze(['agent-tools']) })
  }
  return Object.freeze({ category: 'general', tags: Object.freeze([]) })
}

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
