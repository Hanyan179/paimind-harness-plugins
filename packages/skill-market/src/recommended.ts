import { createHash } from 'node:crypto'
import { strToU8, zipSync, type Zippable } from 'fflate'
import apacheLicense from '../catalog/LICENSE.txt?raw'
import openaiDocsSkill from '../catalog/openai-docs/SKILL.md?raw'
import openaiDocsNotice from '../catalog/openai-docs/NOTICE.txt?raw'
import skillCreatorSkill from '../catalog/skill-creator/SKILL.md?raw'
import skillCreatorNotice from '../catalog/skill-creator/NOTICE.txt?raw'
import skillInstallerSkill from '../catalog/skill-installer/SKILL.md?raw'
import skillInstallerNotice from '../catalog/skill-installer/NOTICE.txt?raw'

export interface SkillCatalogItem {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly version: string
  readonly source: string
  readonly license: string
  readonly digest: string
}

export interface SkillCatalogSnapshot {
  readonly items: readonly Readonly<SkillCatalogItem>[]
}

interface RecommendedSkillSource {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly version: string
  readonly source: string
  readonly license: string
  readonly skill: string
  readonly notice: string
}

interface RecommendedSkillPackage {
  readonly item: Readonly<SkillCatalogItem>
  readonly archive: Buffer
  readonly fileName: string
}

const ZIP_TIMESTAMP = new Date('1980-01-01T00:00:00.000Z')
const SOURCE = 'OpenAI Official · Adapted for Harness'

const SOURCES: readonly RecommendedSkillSource[] = Object.freeze([
  {
    id: 'openai-docs', name: 'openai-docs', version: '1.0.0', source: SOURCE, license: 'Apache-2.0',
    description: '查询 OpenAI 官方产品与 API 文档，并提供直接来源。', skill: openaiDocsSkill, notice: openaiDocsNotice,
  },
  {
    id: 'skill-creator', name: 'skill-creator', version: '1.0.0', source: SOURCE, license: 'Apache-2.0',
    description: '设计和改进符合 Harness 规范的 Skill 技能包。', skill: skillCreatorSkill, notice: skillCreatorNotice,
  },
  {
    id: 'skill-installer', name: 'skill-installer', version: '1.0.0', source: SOURCE, license: 'Apache-2.0',
    description: '通过 PAIMind 技能市场安全检查并安装 Skill。', skill: skillInstallerSkill, notice: skillInstallerNotice,
  },
])

function file(content: string): [Uint8Array, { readonly mtime: Date; readonly level: 6 }] {
  return [strToU8(content), { mtime: ZIP_TIMESTAMP, level: 6 }]
}

function buildPackage(source: RecommendedSkillSource): RecommendedSkillPackage {
  const tree: Zippable = {
    [source.id]: {
      'SKILL.md': file(source.skill),
      'LICENSE.txt': file(apacheLicense),
      'NOTICE.txt': file(source.notice),
    },
  }
  const archive = Buffer.from(zipSync(tree, { level: 6 }))
  const digest = `sha256:${createHash('sha256').update(archive).digest('hex')}`
  return Object.freeze({
    item: Object.freeze({
      id: source.id, name: source.name, description: source.description, version: source.version,
      source: source.source, license: source.license, digest,
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
