/** Product-facing composition above the independently testable runtime packages. */
export interface PaimindFeatureCapabilityDefinition {
  readonly id: `paimind:capability:${string}`
  readonly loaderEntryId: `paimind-capability-${string}`
  /** Runtime packages whose expected state is controlled by this capability switch. */
  readonly packageNames: readonly `@paimind/${string}`[]
  readonly nameZh: string
  readonly nameEn: string
  readonly descriptionZh: string
  readonly descriptionEn: string
  readonly defaultEnabled: boolean
}

export interface PaimindFeaturePackDefinition {
  readonly id: `paimind:pack:${string}`
  readonly loaderEntryId: `paimind-pack-${string}`
  readonly nameZh: string
  readonly nameEn: string
  readonly descriptionZh: string
  readonly descriptionEn: string
  readonly order: number
  readonly defaultEnabled: boolean
  readonly requiredPackIds: readonly `paimind:pack:${string}`[]
  readonly packageNames: readonly `@paimind/${string}`[]
  readonly capabilities: readonly PaimindFeatureCapabilityDefinition[]
}

const pack = (definition: PaimindFeaturePackDefinition): Readonly<PaimindFeaturePackDefinition> => Object.freeze({
  ...definition,
  requiredPackIds: Object.freeze([...definition.requiredPackIds]),
  packageNames: Object.freeze([...definition.packageNames]),
  capabilities: Object.freeze(definition.capabilities.map(capability => Object.freeze({ ...capability }))),
})

/**
 * The public product catalog. Technical packages stay independently built and
 * tested, while the Loader exposes only these six product composition groups.
 */
export const PAIMIND_FEATURE_PACKS = Object.freeze([
  pack({
    id: 'paimind:pack:experience', loaderEntryId: 'paimind-pack-experience', order: 10,
    nameZh: '产品体验', nameEn: 'Product Experience', defaultEnabled: true,
    descriptionZh: '品牌界面、显示样式、对话命名、任务状态提示和助手偏好。',
    descriptionEn: 'Paramont branding, visual experience, conversation naming, runtime presence, and personalization.',
    requiredPackIds: [],
    packageNames: ['@paimind/branding', '@paimind/visual-experience', '@paimind/conversation-title', '@paimind/runtime-orbs', '@paimind/user-settings'],
    capabilities: [{
      id: 'paimind:capability:runtime-orbs', loaderEntryId: 'paimind-capability-runtime-orbs',
      packageNames: ['@paimind/runtime-orbs'],
      nameZh: '动态状态提示', nameEn: 'Runtime Orbs', defaultEnabled: true,
      descriptionZh: '在对话与输入区域显示真实运行状态；可独立关闭，不影响其他产品体验。',
      descriptionEn: 'Shows real runtime state in conversation surfaces and can be disabled independently.',
    }],
  }),
  pack({
    id: 'paimind:pack:agents', loaderEntryId: 'paimind-pack-agents', order: 20,
    nameZh: '智能体中心', nameEn: 'Agent Center', defaultEnabled: true,
    descriptionZh: '业务智能体目录、创建与技能能力管理。',
    descriptionEn: 'Business Agent catalog, authoring, and Skill capability management.',
    requiredPackIds: [],
    packageNames: ['@paimind/skill-market', '@paimind/agent-builder', '@paimind/agent-market', '@paimind/mcp-center', '@paimind/feishu-cli-mcp'],
    capabilities: [],
  }),
  pack({
    id: 'paimind:pack:content', loaderEntryId: 'paimind-pack-content', order: 30,
    nameZh: '内容与交付物', nameEn: 'Content & Deliverables', defaultEnabled: true,
    descriptionZh: '使用工作区模板，生成网页、文档、表格和演示，并查看交付文件。',
    descriptionEn: 'Workspace blueprints, workspace artifacts, web and Office generation, file preview, and conversation deliverables.',
    requiredPackIds: [],
    packageNames: [
      '@paimind/workspace-project', '@paimind/workspace-blueprints', '@paimind/better-sidebar-adapter', '@paimind/artifact-runtime',
      '@paimind/generator-web', '@paimind/generator-office', '@paimind/renderer-bento',
      '@paimind/renderer-pdf', '@paimind/artifacts', '@paimind/conversation-artifact-renderer',
    ],
    capabilities: [],
  }),
  pack({
    id: 'paimind:pack:proposal', loaderEntryId: 'paimind-pack-proposal', order: 40,
    nameZh: '提案与演示', nameEn: 'Proposal & Presentation', defaultEnabled: true,
    descriptionZh: '分析商品类目，制作采购提案和演示，并查看结论的数据来源。',
    descriptionEn: 'Category analysis, fact grounding, Bento generation, provenance, and retailer proposal experience.',
    requiredPackIds: ['paimind:pack:content'],
    packageNames: [
      '@paimind/category-analysis-adapter', '@paimind/fact-layer', '@paimind/generator-bento',
      '@paimind/presentation-trace', '@paimind/proposal-experience', '@paimind/walmart-proposal-adapter',
    ],
    capabilities: [],
  }),
  pack({
    id: 'paimind:pack:automation', loaderEntryId: 'paimind-pack-automation', order: 50,
    nameZh: '自动化', nameEn: 'Automation', defaultEnabled: true,
    descriptionZh: '按计划执行任务，接收通知，并通过飞书机器人交付结果。',
    descriptionEn: 'Notifications, scheduled work, Harness execution, HTTP APIs, and Feishu bot delivery.',
    requiredPackIds: ['paimind:pack:content'],
    packageNames: [
      '@paimind/notifications', '@paimind/platform-scheduler', '@paimind/scheduler-adapter-harness',
      '@paimind/scheduler-adapter-http', '@paimind/platform-api', '@paimind/scheduler-adapter-feishu-bot',
    ],
    capabilities: [],
  }),
  pack({
    id: 'paimind:pack:operations', loaderEntryId: 'paimind-pack-operations', order: 60,
    nameZh: '任务与诊断', nameEn: 'Work Operations', defaultEnabled: true,
    descriptionZh: '任务摘要、运行诊断和面向开发者的资源入口。',
    descriptionEn: 'Task summaries, runtime diagnostics, and developer-facing resources.',
    requiredPackIds: ['paimind:pack:content'],
    packageNames: ['@paimind/task-monitor', '@paimind/developer-resources'],
    capabilities: [],
  }),
] as const)

export type PaimindFeaturePackId = typeof PAIMIND_FEATURE_PACKS[number]['id']
export type PaimindFeatureCapabilityId = typeof PAIMIND_FEATURE_PACKS[number]['capabilities'][number]['id']
export type PaimindFeatureToggleId = PaimindFeaturePackId | PaimindFeatureCapabilityId

const PACK_BY_ID = new Map<string, Readonly<PaimindFeaturePackDefinition>>(
  PAIMIND_FEATURE_PACKS.map(definition => [definition.id, definition]),
)
const CAPABILITY_BY_ID = new Map<string, Readonly<PaimindFeatureCapabilityDefinition>>(
  PAIMIND_FEATURE_PACKS.flatMap(definition => definition.capabilities.map(capability => [capability.id, capability] as const)),
)

export function findPaimindFeaturePack(id: string): Readonly<PaimindFeaturePackDefinition> | undefined {
  return PACK_BY_ID.get(id)
}

export function findPaimindFeatureCapability(id: string): Readonly<PaimindFeatureCapabilityDefinition> | undefined {
  return CAPABILITY_BY_ID.get(id)
}

export type PaimindFeatureOverrides = Readonly<Record<string, boolean>>

/** Ignore stale or unknown keys so a removed implementation package cannot poison startup. */
export function decodePaimindFeatureOverrides(value: unknown): PaimindFeatureOverrides {
  if (typeof value !== 'string') return Object.freeze({})
  try {
    const candidate = JSON.parse(value) as unknown
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) return Object.freeze({})
    const result: Record<string, boolean> = {}
    for (const [id, enabled] of Object.entries(candidate)) {
      if (typeof enabled !== 'boolean') continue
      if (PACK_BY_ID.has(id) || CAPABILITY_BY_ID.has(id)) result[id] = enabled
    }
    return Object.freeze(result)
  } catch {
    return Object.freeze({})
  }
}

export function featureToggleEnabled(id: string, overrides: PaimindFeatureOverrides): boolean {
  const definition = PACK_BY_ID.get(id) ?? CAPABILITY_BY_ID.get(id)
  return overrides[id] ?? definition?.defaultEnabled ?? false
}

export const PAIMIND_FEATURE_PACK_SETTINGS_NAMESPACE = 'paimind.feature-packs'

export interface PaimindFeatureCapabilityState extends PaimindFeatureCapabilityDefinition {
  readonly installed: boolean
  readonly enabled: boolean
  /** Persisted product intent, kept separate from the observed runtime state. */
  readonly desiredEnabled?: boolean
  /** Loader reconciliation failure that prevents the desired state. */
  readonly failure?: string
}

export interface PaimindFeaturePackState extends Omit<PaimindFeaturePackDefinition, 'capabilities'> {
  readonly installed: boolean
  readonly enabled: boolean
  /** Persisted product intent, kept separate from the observed runtime state. */
  readonly desiredEnabled?: boolean
  /** Loader reconciliation failure that prevents the desired state. */
  readonly failure?: string
  readonly capabilities: readonly Readonly<PaimindFeatureCapabilityState>[]
}

export type PaimindFeaturePackView =
  | { readonly status: 'unavailable' }
  | {
      readonly status: 'ready'
      readonly packs: readonly Readonly<PaimindFeaturePackState>[]
      readonly revision: number
      readonly writable: boolean
    }

export interface PaimindFeatureToggleMutationRequest {
  readonly id: string
  readonly enabled: boolean
  readonly expectedRevision: number
}
