/** Product-facing composition above the independently testable runtime packages. */
export interface PaimindFeatureCapabilityDefinition {
  readonly id: `paimind:capability:${string}`
  readonly loaderEntryId: `paimind-capability-${string}`
  /** Runtime packages whose expected state is controlled by this capability switch. */
  readonly packageNames: readonly `@hansen/${string}`[]
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
  readonly packageNames: readonly `@hansen/${string}`[]
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
    descriptionZh: '自定义品牌界面、视觉体验、对话命名、运行状态提示和个性化。',
    descriptionEn: 'Custom branding, visual experience, conversation naming, runtime presence, and personalization.',
    requiredPackIds: [],
    packageNames: ['@hansen/branding', '@hansen/visual-experience', '@hansen/conversation-title', '@hansen/runtime-orbs', '@hansen/user-settings'],
    capabilities: [{
      id: 'paimind:capability:runtime-orbs', loaderEntryId: 'paimind-capability-runtime-orbs',
      packageNames: ['@hansen/runtime-orbs'],
      nameZh: '动态状态球', nameEn: 'Runtime Orbs', defaultEnabled: true,
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
    packageNames: ['@hansen/skill-market', '@hansen/agent-builder', '@hansen/agent-market'],
    capabilities: [],
  }),
  pack({
    id: 'paimind:pack:content', loaderEntryId: 'paimind-pack-content', order: 30,
    nameZh: '内容与交付物', nameEn: 'Content & Deliverables', defaultEnabled: true,
    descriptionZh: '工作区模板、工作区产物、网页与 Office 生成、文件预览和对话交付物展示。',
    descriptionEn: 'Workspace blueprints, workspace artifacts, web and Office generation, file preview, and conversation deliverables.',
    requiredPackIds: [],
    packageNames: [
      '@hansen/workspace-project', '@hansen/workspace-blueprints', '@hansen/better-sidebar-adapter', '@hansen/artifact-runtime',
      '@hansen/generator-web', '@hansen/generator-office', '@hansen/renderer-bento',
      '@hansen/renderer-pdf', '@hansen/artifacts', '@hansen/conversation-artifact-renderer',
    ],
    capabilities: [],
  }),
  pack({
    id: 'paimind:pack:proposal', loaderEntryId: 'paimind-pack-proposal', order: 40,
    nameZh: '提案与演示', nameEn: 'Proposal & Presentation', defaultEnabled: true,
    descriptionZh: '类目分析、事实层、Bento 演示生成、来源追踪和零售商提案体验。',
    descriptionEn: 'Category analysis, fact grounding, Bento generation, provenance, and retailer proposal experience.',
    requiredPackIds: ['paimind:pack:content'],
    packageNames: [
      '@hansen/category-analysis-adapter', '@hansen/fact-layer', '@hansen/generator-bento',
      '@hansen/presentation-trace', '@hansen/proposal-experience', '@hansen/walmart-proposal-adapter',
    ],
    capabilities: [],
  }),
  pack({
    id: 'paimind:pack:automation', loaderEntryId: 'paimind-pack-automation', order: 50,
    nameZh: '自动化', nameEn: 'Automation', defaultEnabled: true,
    descriptionZh: '通知、平台定时任务、Harness 执行适配、HTTP 接口和飞书机器人交付。',
    descriptionEn: 'Notifications, scheduled work, Harness execution, HTTP APIs, and Feishu bot delivery.',
    requiredPackIds: ['paimind:pack:content'],
    packageNames: [
      '@hansen/notifications', '@hansen/platform-scheduler', '@hansen/scheduler-adapter-harness',
      '@hansen/scheduler-adapter-http', '@hansen/platform-api', '@hansen/scheduler-adapter-feishu-bot',
    ],
    capabilities: [],
  }),
  pack({
    id: 'paimind:pack:operations', loaderEntryId: 'paimind-pack-operations', order: 60,
    nameZh: '工作运营', nameEn: 'Work Operations', defaultEnabled: true,
    descriptionZh: '任务摘要、运行诊断和面向开发者的资源入口。',
    descriptionEn: 'Task summaries, runtime diagnostics, and developer-facing resources.',
    requiredPackIds: ['paimind:pack:content'],
    packageNames: ['@hansen/task-monitor', '@hansen/developer-resources'],
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
