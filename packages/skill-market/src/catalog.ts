import type { HarnessSkillEntry } from '@hansen/harness-compat'

export const PAIMIND_SKILL_UPLOAD_PATH = '/paimind/skills/uploads'
export const SKILL_PRODUCT_CATEGORIES = ['all', 'general', 'research', 'data', 'content', 'product', 'engineering', 'agent-tools'] as const
export type SkillProductCategoryFilter = typeof SKILL_PRODUCT_CATEGORIES[number]
export type SkillProductCategory = Exclude<SkillProductCategoryFilter, 'all'>

export interface SkillProductMetadata {
  readonly category: SkillProductCategory
  readonly tags: readonly string[]
}

const SKILL_PRODUCT_CATEGORY_SET: ReadonlySet<string> = new Set(SKILL_PRODUCT_CATEGORIES)

function isSkillProductCategory(value: unknown): value is SkillProductCategory {
  return typeof value === 'string' && value !== 'all' && SKILL_PRODUCT_CATEGORY_SET.has(value)
}

function normalizedProductTags(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return Object.freeze([])
  return Object.freeze([...new Set(value
    .filter((tag): tag is string => typeof tag === 'string')
    .map(tag => tag.trim().toLocaleLowerCase())
    .filter(tag => tag.length > 0 && tag.length <= 64))]
    .sort())
}

const KNOWN_SKILL_METADATA: Readonly<Record<string, SkillProductMetadata>> = Object.freeze({
  'openai-docs': Object.freeze({ category: 'research', tags: Object.freeze(['official-docs', 'research']) }),
  'bento-ppt': Object.freeze({ category: 'content', tags: Object.freeze(['presentation', 'artifact']) }),
  'ppt-master': Object.freeze({ category: 'content', tags: Object.freeze(['presentation', 'artifact']) }),
  'fineline-investment-analysis': Object.freeze({ category: 'product', tags: Object.freeze(['pdm', 'data-analysis']) }),
  'white-space-analysis': Object.freeze({ category: 'product', tags: Object.freeze(['pdm', 'data-analysis']) }),
  'build-walmart-buyer-proposal-outline': Object.freeze({ category: 'product', tags: Object.freeze(['pdm', 'proposal']) }),
})

/** Prefer catalog-owned taxonomy; known-name and keyword inference only support legacy items without metadata. */
export function metadataForSkill(input: {
  readonly name: string
  readonly description?: string
  readonly whenToUse?: string
  readonly category?: unknown
  readonly tags?: unknown
}): Readonly<SkillProductMetadata> {
  const suppliedTags = normalizedProductTags(input.tags)
  if (isSkillProductCategory(input.category)) {
    return Object.freeze({ category: input.category, tags: suppliedTags })
  }
  const known = KNOWN_SKILL_METADATA[input.name]
  if (known !== undefined) return suppliedTags.length === 0
    ? known
    : Object.freeze({ category: known.category, tags: suppliedTags })
  const searchable = `${input.name} ${input.description ?? ''} ${input.whenToUse ?? ''} ${suppliedTags.join(' ')}`.toLocaleLowerCase()
  if (/\b(research|search|docs?|citation|source|browser|web)\b/.test(searchable)) {
    return Object.freeze({ category: 'research', tags: suppliedTags.length === 0 ? Object.freeze(['research']) : suppliedTags })
  }
  if (/\b(data|analysis|analytics|spreadsheet|excel|sql|chart)\b/.test(searchable)) {
    return Object.freeze({ category: 'data', tags: suppliedTags.length === 0 ? Object.freeze(['data']) : suppliedTags })
  }
  if (/\b(ppt|slides?|presentation|document|pdf|content|report|writing)\b/.test(searchable)) {
    return Object.freeze({ category: 'content', tags: suppliedTags.length === 0 ? Object.freeze(['content']) : suppliedTags })
  }
  if (/\b(product|pdm|proposal|buyer|market|merchandising)\b/.test(searchable)) {
    return Object.freeze({ category: 'product', tags: suppliedTags.length === 0 ? Object.freeze(['product']) : suppliedTags })
  }
  if (/\b(code|coding|developer|engineering|git|test|debug|deploy)\b/.test(searchable)) {
    return Object.freeze({ category: 'engineering', tags: suppliedTags.length === 0 ? Object.freeze(['engineering']) : suppliedTags })
  }
  if (/\b(agent|skill|prompt|workflow|tool)\b/.test(searchable)) {
    return Object.freeze({ category: 'agent-tools', tags: suppliedTags.length === 0 ? Object.freeze(['agent-tools']) : suppliedTags })
  }
  return Object.freeze({ category: 'general', tags: suppliedTags })
}

export interface SkillCatalogRow {
  readonly skill: HarnessSkillEntry
  readonly metadata: Readonly<SkillProductMetadata>
  readonly sourceIndex: number
}

/** Add product-only taxonomy without replacing or copying the native Harness Skill entry. */
export function projectSkillCatalog(
  skills: readonly HarnessSkillEntry[],
  input: { readonly query: string; readonly category?: SkillProductCategoryFilter },
): readonly Readonly<SkillCatalogRow>[] {
  const query = input.query.trim().toLocaleLowerCase()
  const category = input.category ?? 'all'
  return Object.freeze(skills.map((skill, sourceIndex): Readonly<SkillCatalogRow> => {
    const metadata = metadataForSkill(skill)
    return Object.freeze({ skill, metadata, sourceIndex })
  }).filter(row => {
    if (category !== 'all' && row.metadata.category !== category) return false
    if (query === '') return true
    return [
      row.skill.name,
      row.skill.description,
      row.skill.whenToUse ?? '',
      row.metadata.category,
      ...row.metadata.tags,
    ].some(value => value.toLocaleLowerCase().includes(query))
  }))
}
