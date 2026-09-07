import { createHash } from 'node:crypto'
import { strToU8, zipSync, type Zippable } from 'fflate'
import type { SkillProductCategory } from './catalog.js'
import apacheLicense from '../catalog/LICENSE.txt?raw'
import internalLicense from '../catalog/INTERNAL-LICENSE.txt?raw'
import bentoPptSkill from '../catalog/bento-ppt/SKILL.md?raw'
import bentoPptNotice from '../catalog/bento-ppt/NOTICE.txt?raw'
import finelineSkill from '../catalog/fineline-investment-analysis/SKILL.md?raw'
import finelineNotice from '../catalog/fineline-investment-analysis/NOTICE.txt?raw'
import whiteSpaceSkill from '../catalog/white-space-analysis/SKILL.md?raw'
import whiteSpaceNotice from '../catalog/white-space-analysis/NOTICE.txt?raw'
import walmartOutlineSkill from '../catalog/build-walmart-buyer-proposal-outline/SKILL.md?raw'
import walmartOutlineNotice from '../catalog/build-walmart-buyer-proposal-outline/NOTICE.txt?raw'
import openaiDocsSkill from '../catalog/openai-docs/SKILL.md?raw'
import openaiDocsNotice from '../catalog/openai-docs/NOTICE.txt?raw'
import categoryPerformanceSkill from '../catalog/category-performance-analysis/SKILL.md?raw'
import categoryPerformanceNotice from '../catalog/category-performance-analysis/NOTICE.txt?raw'
import categoryOpportunitySkill from '../catalog/category-opportunity-analysis/SKILL.md?raw'
import categoryOpportunityNotice from '../catalog/category-opportunity-analysis/NOTICE.txt?raw'
import proposalAssistantSkill from '../catalog/proposal-assistant-orchestration/SKILL.md?raw'
import proposalAssistantNotice from '../catalog/proposal-assistant-orchestration/NOTICE.txt?raw'

export interface SkillCatalogItem {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly displayNameZh?: string
  readonly version: string
  readonly source: string
  readonly license: string
  readonly digest: string
  readonly category: SkillProductCategory
  readonly tags: readonly string[]
}

export interface SkillCatalogSnapshot {
  readonly items: readonly Readonly<SkillCatalogItem>[]
}

interface RecommendedSkillSource {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly displayNameZh: string
  readonly version: string
  readonly source: string
  readonly license: string
  readonly category: SkillProductCategory
  readonly tags: readonly string[]
  readonly skill: string
  readonly notice: string
  readonly licenseText: string
}

interface RecommendedSkillPackage {
  readonly item: Readonly<SkillCatalogItem>
  readonly archive: Buffer
  readonly fileName: string
}

const ZIP_TIMESTAMP = new Date('1980-01-01T00:00:00.000Z')
const SOURCE = 'OpenAI Official · Adapted for Harness'
const PAIMIND_SOURCE = 'PAIMind Internal · Adapted for Harness'

const SOURCES: readonly RecommendedSkillSource[] = Object.freeze([
  {
    id: 'openai-docs', name: 'openai-docs', version: '1.0.1', source: SOURCE, license: 'Apache-2.0',
    category: 'research', tags: Object.freeze(['official-docs', 'research']),
    displayNameZh: 'OpenAI 官方文档', description: '查阅 OpenAI 官方产品与开发文档，并提供原文来源。', skill: openaiDocsSkill, notice: openaiDocsNotice, licenseText: apacheLicense,
  },
  {
    id: 'bento-ppt', name: 'bento-ppt', version: '1.4.1', source: PAIMIND_SOURCE, license: 'UNLICENSED / Internal Use Only',
    category: 'content', tags: Object.freeze(['artifact', 'presentation']),
    displayNameZh: '演示制作', description: '根据已核实的资料制作网页演示，支持查看数据来源。', skill: bentoPptSkill, notice: bentoPptNotice, licenseText: internalLicense,
  },
  {
    id: 'fineline-investment-analysis', name: 'fineline-investment-analysis', version: '1.0.1', source: PAIMIND_SOURCE, license: 'UNLICENSED / Internal Use Only',
    category: 'product', tags: Object.freeze(['data-analysis', 'pdm']),
    displayNameZh: '沃尔玛细分类目投资分析', description: '基于脱敏的历史数据快照，分析细分类目的投资机会。', skill: finelineSkill, notice: finelineNotice, licenseText: internalLicense,
  },
  {
    id: 'white-space-analysis', name: 'white-space-analysis', version: '1.0.1', source: PAIMIND_SOURCE, license: 'UNLICENSED / Internal Use Only',
    category: 'product', tags: Object.freeze(['data-analysis', 'pdm']),
    displayNameZh: '沃尔玛市场空白分析', description: '基于脱敏的历史数据快照，寻找尚未覆盖的商品机会。', skill: whiteSpaceSkill, notice: whiteSpaceNotice, licenseText: internalLicense,
  },
  {
    id: 'build-walmart-buyer-proposal-outline', name: 'build-walmart-buyer-proposal-outline', version: '1.2.1', source: PAIMIND_SOURCE, license: 'UNLICENSED / Internal Use Only',
    category: 'product', tags: Object.freeze(['pdm', 'proposal']),
    displayNameZh: '沃尔玛采购提案大纲', description: '整理业务分析和采购建议，形成可审阅的提案大纲。', skill: walmartOutlineSkill, notice: walmartOutlineNotice, licenseText: internalLicense,
  },
  {
    id: 'category-performance-analysis', name: 'category-performance-analysis', version: '1.0.1', source: PAIMIND_SOURCE, license: 'UNLICENSED / Internal Use Only',
    category: 'data', tags: Object.freeze(['category-analysis', 'performance']),
    displayNameZh: '类目经营分析', description: '分析商品类目的销售与经营表现，形成有数据依据的结论。', skill: categoryPerformanceSkill, notice: categoryPerformanceNotice, licenseText: internalLicense,
  },
  {
    id: 'category-opportunity-analysis', name: 'category-opportunity-analysis', version: '1.0.1', source: PAIMIND_SOURCE, license: 'UNLICENSED / Internal Use Only',
    category: 'data', tags: Object.freeze(['category-analysis', 'opportunity']),
    displayNameZh: '类目机会分析', description: '结合经营表现寻找商品机会，并说明判断依据。', skill: categoryOpportunitySkill, notice: categoryOpportunityNotice, licenseText: internalLicense,
  },
  {
    id: 'proposal-assistant-orchestration', name: 'proposal-assistant-orchestration', version: '1.0.1', source: PAIMIND_SOURCE, license: 'UNLICENSED / Internal Use Only',
    category: 'product', tags: Object.freeze(['orchestration', 'proposal']),
    displayNameZh: '采购提案助手', description: '澄清提案需求，组织分析、演示制作和数据来源说明。', skill: proposalAssistantSkill, notice: proposalAssistantNotice, licenseText: internalLicense,
  },
])

function file(content: string): [Uint8Array, { readonly mtime: Date; readonly level: 6 }] {
  return [strToU8(content), { mtime: ZIP_TIMESTAMP, level: 6 }]
}

function buildPackage(source: RecommendedSkillSource): RecommendedSkillPackage {
  const tree: Zippable = {
    [source.id]: {
      'SKILL.md': file(source.skill),
      'LICENSE.txt': file(source.licenseText),
      'NOTICE.txt': file(source.notice),
    },
  }
  const archive = Buffer.from(zipSync(tree, { level: 6 }))
  const digest = `sha256:${createHash('sha256').update(archive).digest('hex')}`
  return Object.freeze({
    item: Object.freeze({
      id: source.id, name: source.name, description: source.description, displayNameZh: source.displayNameZh, version: source.version,
      source: source.source, license: source.license, digest, category: source.category, tags: source.tags,
    }),
    archive,
    fileName: `${source.id}-${source.version}.zip`,
  })
}

const PACKAGES = Object.freeze(SOURCES.map(buildPackage))

/** Stable product catalog; execution remains owned by Harness filesystem discovery. */
export const RECOMMENDED_SKILL_CATALOG: readonly Readonly<SkillCatalogItem>[] = Object.freeze(PACKAGES.map(row => row.item))

/** Return immutable package bytes for the shared upload inspection/install pipeline. */
export function recommendedSkillPackage(input: { readonly catalogId: string; readonly version: string }): RecommendedSkillPackage {
  const value = PACKAGES.find(row => row.item.id === input.catalogId && row.item.version === input.version)
  if (value === undefined) throw new Error('推荐 Skill 不存在或版本已更新')
  return value
}
